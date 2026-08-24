import { createReadStream } from "node:fs"
import { stat } from "node:fs/promises"
import { parsePluginVaultDest } from "@hoardodile/host/hoard"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { servedFileContentType } from "./utils.ts"

/**
 * GET /api/plugin-assets/:id/:token/* — the sanctioned reader of a
 * plugin's asset vault (see `VersionPaths.pluginVaultDir`).
 *
 * - Auth: the protected-HTTP preHandler verifies the path token and its
 *   plugin scope (kind + id) before this handler runs; cookie auth works
 *   too. Vault files are host data, so responses are `private, no-cache`
 *   — a re-download replaces the file at the same URL, and stale caches
 *   must never serve the old bytes.
 * - Serving policy: exact MIME for scripts/images/fonts (downloads can
 *   be runtimes), `nosniff` always; only `text/html` degrades to
 *   octet-stream + attachment (never a navigable page; `fetch()` still
 *   reads the body).
 * - Confinement: the relative path is resolved under the plugin's vault
 *   directory (per-segment `assertSafeSegment` + `assertInside`), so a
 *   crafted path can never escape the plugin's own folder.
 */
async function pluginAssetsImpl(app: FastifyInstance): Promise<void> {
	app.get<{ Params: { id: string; token: string; "*": string } }>(
		"/api/plugin-assets/:id/:token/*",
		{ config: { readOnlySafe: true } },
		async (req, reply) => {
			const { id } = req.params
			const relPath = req.params["*"]
			if (relPath === undefined || relPath.length === 0) {
				return reply.status(404).type("application/json").send({
					error: "file not found",
				})
			}

			const vaultDir = app.paths
				.atVersion(app.paths.activeVersion)
				.pluginVaultDir(id)

			let abs: string
			try {
				abs = parsePluginVaultDest(vaultDir, relPath).abs
			} catch {
				return reply.status(403).type("application/json").send({
					error: "forbidden",
				})
			}

			const fileInfo = await stat(abs).catch(() => undefined)
			if (fileInfo === undefined || !fileInfo.isFile()) {
				return reply.status(404).type("application/json").send({
					error: "file not found",
				})
			}

			const ext = relPath.split(".").pop()?.toLowerCase()
			let contentType = servedFileContentType(ext)
			// Only HTML is demoted to an attachable blob: it must never
			// render as a page from the host origin. Everything else
			// (scripts, fonts, images, JSON) keeps its exact MIME.
			const asAttachment = ext === "html" || ext === "htm"
			if (asAttachment) {
				contentType = "application/octet-stream"
			}
			return reply
				.type(contentType)
				.header("cache-control", "private, no-cache")
				.header("x-content-type-options", "nosniff")
				.header("content-disposition", asAttachment ? "attachment" : "inline")
				.send(createReadStream(abs))
		},
	)
}

export const pluginAssetsPlugin = pluginAssetsImpl satisfies FastifyPluginAsync
