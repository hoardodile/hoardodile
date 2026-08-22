import { randomUUID } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { extname, join } from "node:path"
import { pipeline } from "node:stream/promises"
import { resolveFfmpegPaths } from "@hoardodile/host/render"
import { IMAGE_EXTS, VIDEO_EXTS } from "@hoardodile/sdk-types/media-exts"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { generateUploadPreview } from "src/infra/thumb/preview.ts"
import { sendFile } from "./conditional-request.ts"
import { sendError } from "./utils.ts"

/**
 * One-shot preview endpoint for uncommitted files.
 *
 * The client uploads a single file; the server synthesises a downscaled
 * preview (AVIF for still sources, WebP for animated, AVIF for video frames)
 * and streams it straight back. Temp source and output files are deleted
 * after the response is sent so disk usage stays bounded.
 *
 * Form fields:
 * - `file` - exactly one file part.
 *
 * Response: preview image with `Content-Type: image/avif` or
 * `Content-Type: image/webp`.
 */
async function uploadPreviewsPluginImpl(app: FastifyInstance): Promise<void> {
	const ffmpeg = resolveFfmpegPaths()
	const paths = app.paths

	app.post(
		"/api/upload-previews",
		{ config: { readOnlySafe: true } },
		async (req, reply) => {
			if (!req.isMultipart()) {
				return sendError(
					reply,
					415,
					"expected multipart/form-data",
					"resource.upload_preview_not_multipart",
				)
			}

			let processed = false
			for await (const partRaw of req.parts()) {
				const part = partRaw as MultipartPart
				if (part.type === "field") continue
				if (part.fieldname === "file") {
					if (processed) {
						// Drain and reject multiple files
						for await (const _ of part.file) {
							/* discard */
						}
						return sendError(
							reply,
							400,
							"only one file part is allowed",
							"resource.upload_preview_too_many_files",
						)
					}
					processed = true

					const ext = extname(part.filename).toLowerCase()
					const isImage = IMAGE_EXTS.has(ext)
					const isVideo = VIDEO_EXTS.has(ext)
					if (!isImage && !isVideo) {
						for await (const _ of part.file) {
							/* discard */
						}
						return sendError(
							reply,
							400,
							`unsupported file type: ${ext || "unknown"}`,
							"resource.upload_preview_unsupported_type",
						)
					}

					const tmpId = randomUUID()
					const tmpDir = join(paths.local.tmp(), "upload-previews", tmpId)
					const sourcePath = join(tmpDir, `source${ext}`)
					const previewPath = join(tmpDir, "preview")

					try {
						await mkdir(tmpDir, { recursive: true })
						await pipeline(part.file, createWriteStream(sourcePath))

						const { path: finalPreviewPath, contentType } =
							await generateUploadPreview(sourcePath, previewPath, ffmpeg)

						return sendFile(reply, finalPreviewPath, {
							contentType,
							cacheControl: "no-store",
						})
					} catch (err) {
						req.log.warn({ err }, "upload preview generation failed")
						return sendError(
							reply,
							422,
							err instanceof Error ? err.message : "preview generation failed",
							"resource.upload_preview_failed",
						)
					} finally {
						// Fire-and-forget cleanup of the temp directory.
						rm(tmpDir, { recursive: true, force: true }).catch(() => {})
					}
				} else {
					// Unknown file field - drain so the multipart parser can advance.
					for await (const _ of part.file) {
						/* discard */
					}
				}
			}

			if (!processed) {
				return sendError(
					reply,
					400,
					"missing file part",
					"resource.upload_preview_no_file",
				)
			}
		},
	)
}

export const uploadPreviewsPlugin =
	uploadPreviewsPluginImpl satisfies FastifyPluginAsync

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
