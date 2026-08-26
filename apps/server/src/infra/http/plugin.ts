import multipart from "@fastify/multipart"
import fastifySSE from "@fastify/sse"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { cookieOptions } from "src/domain/auth/cookie.ts"
import { backupFilesPlugin } from "./backup-files.ts"
import { cacheAdminPlugin } from "./cache-admin.ts"
import { charFilesPlugin } from "./char-files.ts"
import { charThumbsPlugin } from "./char-thumbs.ts"
import { coversPlugin } from "./covers.ts"
import { imageSearchPlugin } from "./image-search.ts"
import { pluginAssetsPlugin } from "./plugin-assets.ts"
import { pluginMarketplacePlugin } from "./plugin-marketplace.ts"
import { pluginUploadPlugin } from "./plugin-upload.ts"

import { resFilesPlugin } from "./res-files.ts"
import { resUploadArchivePlugin } from "./res-upload-archive.ts"
import { resUploadOrderedPlugin } from "./res-upload-ordered.ts"
import { resUploadPreviewPlugin } from "./res-upload-preview.ts"
import { ssePlugin } from "./sse.ts"
import { uploadPreviewsPlugin } from "./upload-previews.ts"

/**
 * Fastify plugin that registers every session-gated HTTP route under one
 * encapsulated scope. The `preHandler` hook added here inherits down to
 * every sub-plugin registered inside but does not leak out -- tRPC and
 * the public `/auth/*` routes are unaffected.
 *
 * The preHandler is the single source of truth for HTTP-route
 * authentication; individual route handlers can assume that by the time
 * they run, `req.cookies[env.SESSION_COOKIE_NAME]` has been verified and
 * (when stale enough) refreshed via `app.sessions.touch`.
 */
async function protectedHttpPluginImpl(app: FastifyInstance): Promise<void> {
	app.addHook("preHandler", async (req, reply) => {
		// Sandboxed plugin iframes have an opaque origin ("null") and cannot
		// send SameSite=strict cookies. Accept session tokens embedded
		// in the path (/files/<token>/, /frame/<token>/, /extracted/<token>/,
		// /extract-progress/<token>/, /plugin-assets/<id>/<token>/).
		// Same-origin pages use cookies and don't need a token.
		//
		// NOTE: this route-family regex must stay in sync with the same
		// `(?:files|frame|extracted|extract-progress)` token paths in
		// `apps/web/src/sw.ts` and `plugins/workbench/scripts/mounts.mjs`.
		// Token-based auth is only honoured for GET/HEAD /files/,
		// /frame/ and /plugin-assets/ routes - plugin iframes have no
		// business hitting other endpoints. The regex must run against
		// the path alone: req.url includes the query string, which would
		// otherwise let a crafted query (?x=/files/<token>/) smuggle
		// token auth into any route. Tokens are additionally scoped to a
		// single resource or plugin (kind + id), which must match the
		// route's :id param - a leaked token then only exposes that one
		// resource/plugin vault, and routes without root id (e.g. trash
		// file previews, a cookie-authenticated app feature) are not
		// token-authenticated at all.
		const pathname = req.url.split("?", 1)[0] ?? ""
		const pathMatch =
			req.method === "GET" || req.method === "HEAD"
				? pathname.match(
						/\/(?:files|frame|extracted|extract-progress|plugin-assets\/[A-Za-z0-9_.-]+)\/([A-Za-z0-9_.-]+)\//,
					)
				: null
		if (pathMatch !== null) {
			const pathToken = pathMatch[1]
			if (pathToken !== undefined && pathToken.length > 0) {
				const verified = await app.sessions.verifyToken(pathToken)
				const routeId = (
					req.params as Record<string, string | undefined> | undefined
				)?.id
				// `plugin-assets/<id>/<token>` puts the id BEFORE the token
				// (pluginId/assetToken), every other family is /<token>/.
				const isAssetVault = pathname.includes("/plugin-assets/")
				const scopeMatches =
					verified !== undefined &&
					routeId !== undefined &&
					(isAssetVault
						? verified.scope.kind === "plugin" && verified.scope.id === routeId
						: verified.scope.kind === "res" && verified.scope.id === routeId)
				if (scopeMatches) {
					// The res file families embed the token INSIDE the
					// wildcard (`/:id/files/<token>/<path>` resolves as
					// `*` = "files/<token>/<path>"), so the token segment
					// must be stripped for the route handler. The
					// plugin-assets route declares `:token` as its own
					// parameter — its wildcard already IS the vault-relative
					// path and must never be truncated.
					if (!isAssetVault) {
						const wildcard = (
							req.params as Record<string, string> | undefined
						)?.["*"]
						if (wildcard !== undefined) {
							const slashIdx = wildcard.indexOf("/")
							if (slashIdx >= 0) {
								;(req.params as Record<string, string>)["*"] = wildcard.slice(
									slashIdx + 1,
								)
							}
						}
					}
					return
				}
			}
		}

		const cookie = req.cookies[app.env.SESSION_COOKIE_NAME]
		const touched = await app.sessions.touch(
			cookie,
			app.env.SESSION_TTL_SECONDS,
		)
		if (touched === undefined) {
			await reply
				.code(401)
				.type("application/json")
				.send({ error: "unauthorized" })
			return
		}
		if (touched.sealed !== undefined) {
			reply.setCookie(
				app.env.SESSION_COOKIE_NAME,
				touched.sealed,
				cookieOptions(app.env, app.env.SESSION_TTL_SECONDS),
			)
		}

		// While viewing a past archive, block every route that has not been
		// explicitly declared read-only safe via route config metadata.
		// Queries, downloads, SSE, and the bulk-source export (a read-only POST)
		// must opt in with `config: { readOnlySafe: true }`; everything else
		// defaults to 403. This is safer than a method whitelist because it
		// forces every new endpoint to make an explicit decision.
		if (req.server.readOnly === true) {
			const routeConfig = req.routeOptions.config as {
				readOnlySafe?: boolean
			}
			if (routeConfig.readOnlySafe !== true) {
				await reply.code(403).type("application/json").send({
					error:
						"server is viewing a read-only archive; write operations are blocked",
				})
				return
			}
		}
	})

	await app.register(multipart, {
		limits: {
			fileSize: app.env.MAX_UPLOAD_BYTES,
			// Each field is tiny (a fileId UUID or kind/path metadata) and
			// bounded in size by `fieldSize`, but the *count* of text fields
			// grows with the number of files: an ordered upload appends one
			// `fileId` field per file. 512 comfortably covers realistic
			// batches while `fieldSize` still caps total field memory at
			// ~2 MB.
			fieldSize: 4 * 1024,
			fields: 512,
		},
	})

	// Accept raw `application/octet-stream` bodies for streamed uploads
	// (character avatar / fullbody, etc.). Without this Fastify rejects
	// the request with FST_ERR_CTP_INVALID_MEDIA_TYPE before the route
	// handler can read `req.raw`. The parser is intentionally a no-op:
	// the body is consumed by `pipeline(req.raw, ...)` inside the route.
	app.addContentTypeParser(
		"application/octet-stream",
		(_req, _payload, done) => {
			done(null, undefined)
		},
	)

	await app.register(fastifySSE, { heartbeatInterval: 15_000 })

	await app.register(resFilesPlugin)
	await app.register(backupFilesPlugin)
	await app.register(resUploadOrderedPlugin)
	await app.register(resUploadArchivePlugin)
	await app.register(resUploadPreviewPlugin)
	await app.register(uploadPreviewsPlugin)
	await app.register(pluginUploadPlugin)
	await app.register(pluginAssetsPlugin)
	await app.register(pluginMarketplacePlugin)
	await app.register(coversPlugin)
	await app.register(imageSearchPlugin)
	await app.register(cacheAdminPlugin)
	await app.register(charFilesPlugin)
	await app.register(charThumbsPlugin)
	await app.register(ssePlugin)
}

export const protectedHttpPlugin =
	protectedHttpPluginImpl satisfies FastifyPluginAsync
