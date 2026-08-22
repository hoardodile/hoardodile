import { stat, unlink } from "node:fs/promises"
import { extname } from "node:path"
import { AUDIO_EXTS, IMAGE_EXTS } from "@hoardodile/sdk-types/media-exts"
import { isDomainError } from "@hoardodile/shared"

import type { FastifyInstance, FastifyPluginAsync, FastifyReply } from "fastify"
import type { SourceArtifactView } from "src/domain/res/source-view.ts"
import { sendFile } from "./conditional-request.ts"
import { sendByteRangeWithHttpRange } from "./range-send.ts"
import {
	extToContentType,
	imageFormatContentType,
	parseSafeIdParam,
	resThumbParamsSchema,
	sendJson,
} from "./utils.ts"

const COVER_UPLOAD_EXTS = IMAGE_EXTS

/**
 * Fastify plugin registering local cover serving, video frame, cache-wipe,
 * and permanent cover CRUD routes.
 */
async function coversPluginImpl(app: FastifyInstance): Promise<void> {
	const thumbs = app.thumbService
	const resources = app.resService

	/**
	 * `GET /api/resources/:id/cover`
	 *
	 * Unified cover endpoint. Query params:
	 *   - `size`   = "thumb" | "original" (default: "thumb")
	 *   - `format` = "image" | "video" | "audio" (default: "image")
	 *
	 * For `size=thumb` + `format=image`: card-size thumbnail, 404 on miss.
	 * For `size=original` + `format=video`/`audio`: streams with Range support, 404 on miss.
	 * Format is always AVIF; animated sources are downgraded to WebP internally.
	 */
	app.get<{
		Params: { id: string }
		Querystring: { size?: string; format?: string }
	}>(
		"/api/resources/:id/cover",
		{
			schema: { params: resThumbParamsSchema },
			config: { readOnlySafe: true },
		},
		async (req, reply) => {
			const id = parseSafeIdParam(reply, req.params.id)
			if (id === undefined) return reply
			const size = req.query.size === "original" ? "original" : "thumb"
			const streamFormat =
				req.query.format === "video"
					? "video"
					: req.query.format === "audio"
						? "audio"
						: "image"
			try {
				// Check for permanent cover first.
				const coverPath = await resources.findCover(id)

				if (
					coverPath !== undefined &&
					size === "original" &&
					streamFormat === "image"
				) {
					return sendOriginalWithRange(
						reply,
						coverPath,
						"image/*",
						req.headers.range,
						req.headers["if-none-match"],
					)
				}

				if (size === "original") {
					// No permanent cover - resolve from source artifact for
					// video/audio passthrough.
					let view: SourceArtifactView
					try {
						view = await resources.resolveSourceView(id)
					} catch {
						return noCover(reply)
					}
					const sourceFile = await resources.resolveLocalCoverSource(id)
					if (sourceFile === undefined) {
						return noCover(reply)
					}
					const ext = sourceFile
						.slice(sourceFile.lastIndexOf("."))
						.toLowerCase()
					const contentType = extToContentType(ext)

					if (
						(streamFormat === "video" && (ext === ".webm" || ext === ".mp4")) ||
						(streamFormat === "audio" && AUDIO_EXTS.has(ext))
					) {
						try {
							const entry = await view.openEntryStream(sourceFile)
							if (
								applyNotModified(
									reply,
									entry.size,
									entry.mtimeMs,
									req.headers.range,
									req.headers["if-none-match"],
								)
							) {
								return reply
							}
							// Literal entries serve through a kernel-seeked
							// window (the container's full-file stream is
							// destroyed so the range request leaks no handle);
							// virtual (archive-inner) entries stream the
							// decompressed bytes.
							if (entry.path !== undefined) {
								entry.stream.destroy()
							}
							return sendByteRangeWithHttpRange(
								reply,
								entry.path !== undefined
									? {
											path: entry.path,
											start: 0,
											end: entry.size - 1,
											size: entry.size,
										}
									: {
											openStream: async () => entry.stream,
											size: entry.size,
										},
								contentType,
								req.headers.range,
							)
						} catch {
							return noCover(reply)
						}
					}
					return noCover(reply)
				}

				// size=thumb - synthesize local cover thumbnail.
				const result = await thumbs.getCover(id, coverPath)
				if (result.kind === "unavailable") {
					return noCover(reply)
				}
				return sendFile(reply, result.path, {
					contentType: imageFormatContentType(result.format),
					cacheControl: "private, max-age=604800, must-revalidate",
					conditional: { headers: req.headers },
				})
			} catch (err) {
				req.log.error({ err, id, size, streamFormat }, "cover synth failed")
				return sendJson(reply, 500, { error: "cover synth failed" })
			}
		},
	)

	/**
	 * `PUT /api/resources/:id/cover`
	 *
	 * Upload a permanent cover for a resource. Stored at
	 * `versions/<v>/resources/<id>/.cover.<ext>`. Body must be
	 * `application/octet-stream`; the extension is taken from the
	 * `X-Filename` request header. Image covers only.
	 * Eagerly renders a local cover variant after upload.
	 */
	app.put<{ Params: { id: string } }>(
		"/api/resources/:id/cover",
		{ schema: { params: resThumbParamsSchema } },
		async (req, reply) => {
			const id = parseSafeIdParam(reply, req.params.id)
			if (id === undefined) return reply
			const filenameHeader = req.headers["x-filename"]
			const rawFilename =
				typeof filenameHeader === "string" ? filenameHeader : undefined
			if (rawFilename === undefined || rawFilename.length === 0) {
				return sendJson(reply, 400, { error: "X-Filename header is required" })
			}
			const ext = extname(rawFilename).toLowerCase()
			if (!COVER_UPLOAD_EXTS.has(ext)) {
				return sendJson(reply, 415, {
					error: `unsupported cover extension: ${ext}`,
				})
			}
			const ct = req.headers["content-type"]
			const head =
				typeof ct === "string"
					? (ct.split(";")[0] ?? "").trim().toLowerCase()
					: ""
			if (head !== "application/octet-stream") {
				return sendJson(reply, 415, {
					error: "upload must be application/octet-stream",
				})
			}
			const declaredLen = Number(req.headers["content-length"])
			if (
				Number.isFinite(declaredLen) &&
				declaredLen > app.env.MAX_UPLOAD_BYTES
			) {
				return sendJson(reply, 413, { error: "upload exceeds maximum size" })
			}
			let buf: Buffer
			try {
				const chunks: Buffer[] = []
				let total = 0
				for await (const chunk of req.raw) {
					const b = typeof chunk === "string" ? Buffer.from(chunk) : chunk
					total += b.length
					if (total > app.env.MAX_UPLOAD_BYTES) {
						return sendJson(reply, 413, {
							error: "upload exceeds maximum size",
						})
					}
					chunks.push(b)
				}
				buf = Buffer.concat(chunks)
			} catch (err) {
				req.log.error({ err, id }, "cover upload stream failed")
				return sendJson(reply, 500, { error: "upload failed" })
			}
			try {
				await resources.setCover(id, ext, buf)
			} catch (err) {
				if (isDomainError(err) && err.code === "NOT_FOUND") {
					return sendJson(reply, 404, { error: err.message })
				}
				req.log.error({ err, id }, "cover upload commit failed")
				return sendJson(reply, 500, { error: "upload commit failed" })
			}
			const cached = app.paths.local.localCover("resource", id, "cover")
			await unlink(cached).catch(() => {})
			// uploadWarmCover may have an in-flight archive-source render
			// that shares the same queue key. Join it (without starting
			// a new job) and discard its stale output before re-rendering
			// from the permanent cover.
			const inFlight = thumbs.queue.join(cached)
			if (inFlight !== undefined) {
				await inFlight.catch(() => {})
				await unlink(cached).catch(() => {})
			}
			// Resolve the permanent cover path so the eager render uses the
			// uploaded file as its source instead of falling back to the
			// content plugin's buildLocalCover (which may point at a source
			// artifact like the first page). Without this, the cached
			// thumb would show the old/source cover until the user clears
			// their cache.
			const coverPath = await resources.findCover(id)
			try {
				await thumbs.getCover(id, coverPath)
			} catch (err) {
				req.log.warn({ err, id }, "eager cover render failed")
			}
			reply.code(201)
			return { path: `/api/resources/${id}/cover` }
		},
	)

	/**
	 * `DELETE /api/resources/:id/cover`
	 *
	 * Remove the user-attached permanent cover. Idempotent.
	 * Invalidates the cached cover thumbnail so the next request
	 * regenerates from the source fallback.
	 */
	app.delete<{ Params: { id: string } }>(
		"/api/resources/:id/cover",
		{ schema: { params: resThumbParamsSchema } },
		async (req, reply) => {
			const id = parseSafeIdParam(reply, req.params.id)
			if (id === undefined) return reply
			try {
				await resources.clearCover(id)
			} catch (err) {
				if (isDomainError(err) && err.code === "NOT_FOUND") {
					return sendJson(reply, 404, { error: err.message })
				}
				req.log.error({ err, id }, "cover delete failed")
				return sendJson(reply, 500, { error: "cover delete failed" })
			}
			const cached = app.paths.local.localCover("resource", id, "cover")
			await unlink(cached).catch(() => {})
			reply.code(204)
			return reply.send()
		},
	)

	/**
	 * `GET /api/resources/:id/frame/:token/:filename/:time`
	 *
	 * Extracts a single video frame at the requested time (milliseconds) and
	 * returns it as a WebP thumbnail. Synthesised on-demand via ffmpeg;
	 * the result is cached on disk.
	 */
	app.get<{
		Params: { id: string; token: string; filename: string; time: string }
	}>(
		"/api/resources/:id/frame/:token/:filename/:time",
		{
			schema: {
				params: {
					type: "object",
					properties: {
						id: { type: "string", minLength: 1, maxLength: 255 },
						token: { type: "string", minLength: 1 },
						filename: { type: "string", minLength: 1 },
						time: { type: "string", minLength: 1 },
					},
					required: ["id", "token", "filename", "time"],
				},
			},
			config: { readOnlySafe: true },
		},
		handleFrameRequest,
	)

	async function handleFrameRequest(
		req: {
			params: { id: string; filename: string; time: string }
			log: { error: (obj: object, msg: string) => void }
		},
		reply: FastifyReply,
	) {
		const id = parseSafeIdParam(reply, req.params.id)
		if (id === undefined) return reply
		const timeMs = Number(req.params.time)
		if (!Number.isFinite(timeMs) || timeMs < 0) {
			return sendJson(reply, 400, { error: "invalid time" })
		}
		try {
			const result = await thumbs.getVideoFrame(id, req.params.filename, timeMs)
			if (result.kind === "unavailable") {
				return sendJson(reply, 404, { error: "frame unavailable" })
			}
			return sendFile(reply, result.path, {
				contentType: imageFormatContentType(result.format),
				cacheControl: "private, max-age=31536000, immutable",
			})
		} catch (err) {
			req.log.error({ err, id, timeMs }, "frame extraction failed")
			return sendJson(reply, 500, { error: "frame extraction failed" })
		}
	}
}

export const coversPlugin = coversPluginImpl satisfies FastifyPluginAsync

/**
 * The canonical "this resource has no cover" response: a 404 whose
 * `reason` field tells clients to render their text tile instead of an
 * image.
 */
function noCover(reply: FastifyReply): void {
	sendJson(reply, 404, { error: "no cover", reason: "placeholder" })
}

/**
 * Send an original (non-local) cover file, with Range support for video/audio.
 */
async function sendOriginalWithRange(
	reply: FastifyReply,
	path: string,
	contentType: string,
	rangeHeader: string | undefined,
	ifNoneMatch: string | undefined,
): Promise<FastifyReply> {
	let sizeBytes: number
	let mtimeMs: number
	try {
		const info = await stat(path)
		sizeBytes = info.size
		mtimeMs = info.mtimeMs
	} catch {
		sendJson(reply, 404, { error: "cover file not found" })
		return reply
	}
	if (applyNotModified(reply, sizeBytes, mtimeMs, rangeHeader, ifNoneMatch)) {
		return reply
	}
	return sendByteRangeWithHttpRange(
		reply,
		{
			path,
			start: 0,
			end: sizeBytes === 0 ? 0 : sizeBytes - 1,
			size: sizeBytes,
		},
		contentType,
		rangeHeader,
	)
}

/**
 * Set the entity tag (`size-mtime`, stable because resources are
 * immutable) and answer 304 when the client revalidates an unchanged
 * full representation. Range requests never shortcut — the tag still
 * anchors If-Range resume. Returns true when a 304 was sent.
 */
function applyNotModified(
	reply: FastifyReply,
	size: number,
	mtimeMs: number | undefined,
	rangeHeader: string | undefined,
	ifNoneMatch: string | undefined,
): boolean {
	if (mtimeMs === undefined) return false
	const etag = `"${size}-${Math.floor(mtimeMs)}"`
	reply.header("etag", etag)
	if (
		(rangeHeader === undefined || !rangeHeader.startsWith("bytes=")) &&
		ifNoneMatch === etag
	) {
		reply.code(304)
		reply.send()
		return true
	}
	return false
}
