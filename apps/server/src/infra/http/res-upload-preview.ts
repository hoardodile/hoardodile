import { mkdir, readdir } from "node:fs/promises"
import { extname, join } from "node:path"
import { resolveFfmpegPaths } from "@hoardodile/host/render"
import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify"
import {
	generateUploadPreview,
	uploadPreviewCacheDir,
} from "src/infra/thumb/preview.ts"
import { sendFile } from "./conditional-request.ts"
import { domainErrorToHttp, extToContentType, sendJson } from "./utils.ts"

/**
 * Staged file preview endpoint.
 *
 * GET /api/uploads/staged/:fileId/preview
 *   Generates (once) a downscaled preview for a single file staged in
 *   the global pool and caches it at
 *   `{tmp}/upload-previews/<fileId>.<fmt>` — staged files are
 *   immutable, so the fileId is a stable cache key. Later requests
 *   (reorder-triggered refetches, viewport flips) hit the cache
 *   instead of re-rendering. The cache lives under `local/cache/tmp`,
 *   so the boot-time tmp sweep and "clear cache" both reclaim it.
 */
async function resUploadPreviewPluginImpl(app: FastifyInstance): Promise<void> {
	const uploads = app.resUploads
	const ffmpeg = resolveFfmpegPaths()
	const cacheDir = uploadPreviewCacheDir(app.paths.local.tmp())

	// Single-flight per fileId: concurrent preview requests for the same
	// staged file share one render.
	const inflight = new Map<string, Promise<PreviewCacheEntry | undefined>>()

	app.get(
		"/api/uploads/staged/:fileId/preview",
		{ config: { readOnlySafe: true } },
		async (req, reply) => {
			const { fileId } = req.params as { fileId: string }

			const sourcePath = await uploads.resolveStagedFile(fileId)
			if (sourcePath === undefined) {
				return sendJson(reply, 404, {
					error: "staged file not found",
					kind: "resource.upload_preview_file_not_found",
				})
			}

			const cached = await findCachedPreview(cacheDir, fileId)
			if (cached !== undefined) {
				return sendPreview(reply, cached)
			}

			let pending = inflight.get(fileId)
			if (pending === undefined) {
				pending = renderAndCache(cacheDir, fileId, sourcePath, ffmpeg).finally(
					() => inflight.delete(fileId),
				)
				inflight.set(fileId, pending)
			}
			let rendered: PreviewCacheEntry | undefined
			try {
				rendered = await pending
			} catch (err) {
				req.log.warn({ err }, "staging preview generation failed")
				return domainErrorToHttp(reply, err)
			}
			if (rendered === undefined) {
				return domainErrorToHttp(reply, new Error("preview render failed"))
			}
			return sendPreview(reply, rendered)
		},
	)
}

type PreviewCacheEntry = {
	readonly path: string
	readonly contentType: string
}

/** Look up an existing cached preview by fileId (`<fileId>.<fmt>`). */
async function findCachedPreview(
	cacheDir: string,
	fileId: string,
): Promise<PreviewCacheEntry | undefined> {
	const names = await readdir(cacheDir).catch(() => [])
	const name = names.find((n) => n.startsWith(`${fileId}.`))
	if (name === undefined) return undefined
	const path = join(cacheDir, name)
	return { path, contentType: extToContentType(extname(name)) }
}

/**
 * Render a staged file's preview straight into the cache dir and hand
 * back the entry. `generateUploadPreview` appends the output format
 * extension, so the cache name is `<fileId>.<fmt>` and the Content-Type
 * follows from it.
 */
async function renderAndCache(
	cacheDir: string,
	fileId: string,
	sourcePath: string,
	ffmpeg: Awaited<ReturnType<typeof resolveFfmpegPaths>>,
): Promise<PreviewCacheEntry | undefined> {
	await mkdir(cacheDir, { recursive: true })
	const result = await generateUploadPreview(
		sourcePath,
		join(cacheDir, fileId),
		ffmpeg,
	)
	return { path: result.path, contentType: result.contentType }
}

async function sendPreview(
	reply: FastifyReply,
	entry: PreviewCacheEntry,
): Promise<FastifyReply> {
	return sendFile(reply, entry.path, {
		contentType: entry.contentType,
		cacheControl: "no-store",
	})
}

export const resUploadPreviewPlugin =
	resUploadPreviewPluginImpl satisfies FastifyPluginAsync
