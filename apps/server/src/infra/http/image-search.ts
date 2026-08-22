import { createWriteStream } from "node:fs"
import { extname } from "node:path"
import { pipeline } from "node:stream/promises"
import { IMAGE_EXTS } from "@hoardodile/sdk-types/media-exts"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { sendFile } from "./conditional-request.ts"
import {
	extToContentType,
	parseSafeIdParam,
	sendError,
	sendJson,
} from "./utils.ts"

/** Query sessions older than this are reclaimed by the TTL sweep. */
const IMAGE_SEARCH_SESSION_MAX_AGE_MS = 24 * 60 * 60 * 1000

/**
 * Reverse-image-search endpoints.
 *
 * `POST /api/image-search` accepts a single image part, stores it as a
 * query session (image + perceptual hashes under `{tmp}/image-search/`),
 * and answers `{ sessionId }` — the client navigates to `/search`
 * with the id, and the `res.imageSearch` tRPC procedure runs the
 * similarity scan. `GET /api/image-search/:sessionId/image` streams the
 * stored query image back so the results page can show it.
 *
 * Form fields:
 * - `file` - exactly one image file part.
 */
async function imageSearchPluginImpl(app: FastifyInstance): Promise<void> {
	const sessions = app.resService.imageSearchSessions

	app.post(
		"/api/image-search",
		{ config: { readOnlySafe: true } },
		async (req, reply) => {
			if (!req.isMultipart()) {
				return sendError(
					reply,
					415,
					"expected multipart/form-data",
					"resource.image_search_not_multipart",
				)
			}

			let handled = false
			for await (const partRaw of req.parts()) {
				const part = partRaw as MultipartPart
				if (part.type === "field") continue
				if (part.fieldname === "file") {
					if (handled) {
						// Drain and reject multiple files.
						for await (const _ of part.file) {
							/* discard */
						}
						return sendError(
							reply,
							400,
							"only one file part is allowed",
							"resource.image_search_too_many_files",
						)
					}
					handled = true

					const ext = extname(part.filename).toLowerCase()
					if (!IMAGE_EXTS.has(ext)) {
						for await (const _ of part.file) {
							/* discard */
						}
						return sendError(
							reply,
							400,
							`unsupported file type: ${ext || "unknown"}`,
							"resource.image_search_unsupported_type",
						)
					}

					const { sessionId, imagePath } = await sessions.beginSession(ext)
					try {
						await pipeline(part.file, createWriteStream(imagePath))
					} catch (err) {
						req.log.warn({ err }, "image search upload failed")
						await sessions.discard(sessionId)
						return sendError(
							reply,
							422,
							err instanceof Error ? err.message : "image search upload failed",
							"resource.image_search_upload_failed",
						)
					}
					const usable = await sessions.finalizeSession(sessionId)
					if (!usable) {
						return sendError(
							reply,
							422,
							"image could not be decoded",
							"resource.image_search_undecodable",
						)
					}
					// Opportunistic TTL sweep of stale sessions.
					void sessions.sweep(IMAGE_SEARCH_SESSION_MAX_AGE_MS)
					return sendJson(reply, 200, { sessionId })
				} else {
					// Unknown file field - drain so the multipart parser can advance.
					for await (const _ of part.file) {
						/* discard */
					}
				}
			}

			if (!handled) {
				return sendError(
					reply,
					400,
					"missing file part",
					"resource.image_search_no_file",
				)
			}
		},
	)

	app.get(
		"/api/image-search/:sessionId/image",
		{ config: { readOnlySafe: true } },
		async (req, reply) => {
			const { sessionId: raw } = req.params as { sessionId: string }
			const sessionId = parseSafeIdParam(reply, raw)
			if (sessionId === undefined) return reply
			const image = await sessions.queryImage(sessionId)
			if (image === undefined) {
				return sendJson(reply, 404, {
					error: "image search session not found",
					kind: "resource.image_search_session_not_found",
				})
			}
			return sendFile(reply, image.path, {
				contentType: extToContentType(image.ext),
				cacheControl: "no-store",
			})
		},
	)
}

export const imageSearchPlugin =
	imageSearchPluginImpl satisfies FastifyPluginAsync

type MultipartFilePart = {
	readonly type: "file"
	readonly fieldname: string
	readonly filename: string
	readonly file: NodeJS.ReadableStream
}

type MultipartPart =
	| {
			readonly type: "field"
			readonly fieldname: string
			readonly value: unknown
	  }
	| MultipartFilePart
