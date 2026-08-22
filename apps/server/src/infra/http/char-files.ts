import { createWriteStream } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { extname, join } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { IMAGE_EXTS } from "@hoardodile/sdk-types/media-exts"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { sendFile } from "./conditional-request.ts"
import {
	domainErrorToHttp,
	extToContentType,
	parseSafeIdParam,
	sendError,
} from "./utils.ts"

/**
 * The shared image-extension set: avatar/fullbody uploads accept every
 * still-image format the thumbnail pipeline decodes (see
 * `@hoardodile/sdk-types/media-exts`), keeping the gate in one place.
 */
const IMAGE_EXTENSIONS = IMAGE_EXTS

/**
 * JSON Schema for `:id` / `:variant` path params. ajv rejects the obvious
 * malformed shapes (missing fields, wrong variant) at the framework
 * boundary; `assertSafeSegment` inside the handler enforces the stricter
 * filesystem rules that JSON Schema cannot express.
 */
const charImageParamsSchema = {
	type: "object",
	properties: {
		id: { type: "string", minLength: 1, maxLength: 255 },
		variant: { type: "string", enum: ["avatar", "fullbody"] },
	},
	required: ["id", "variant"],
} as const

const uploadHeadersSchema = {
	type: "object",
	properties: {
		"content-type": { type: "string", minLength: 1 },
		"x-filename": { type: "string", minLength: 1, maxLength: 255 },
	},
	required: ["content-type", "x-filename"],
} as const

/**
 * Fastify plugin registering raw-HTTP routes for character image uploads
 * and deletes:
 *
 *   PUT    /api/characters/:id/images/:variant  -- upload avatar or fullbody
 *   DELETE /api/characters/:id/images/:variant  -- remove avatar or fullbody
 *
 * `variant` must be `avatar` or `fullbody`. The upload body must be
 * `application/octet-stream`; the filename (and thus extension) is taken
 * from the `X-Filename` request header so the route URL stays clean.
 *
 * The actual file writes are delegated to `charService.setImage` /
 * `charService.clearImage`, which route through `writeVersioned` so the
 * bytes always land under `paths.latest` and the read-only archive gate
 * is respected. The HTTP layer only validates transport concerns and
 * streams the body into a temporary file.
 */
async function charFilesPluginImpl(app: FastifyInstance): Promise<void> {
	const env = app.env
	const paths = app.paths
	const service = app.charService

	app.get<{ Params: { id: string; variant: string } }>(
		"/api/characters/:id/images/:variant",
		{
			schema: { params: charImageParamsSchema },
			config: { readOnlySafe: true },
		},
		async (req, reply) => {
			const id = parseSafeIdParam(reply, req.params.id)
			if (id === undefined) return reply

			const variant = req.params.variant
			if (variant !== "avatar" && variant !== "fullbody") {
				return sendError(reply, 400, "variant must be avatar or fullbody")
			}

			let imagePath: string | undefined
			try {
				imagePath = await service.resolveImagePath(id, variant)
			} catch (err) {
				return domainErrorToHttp(reply, err)
			}

			if (imagePath === undefined) {
				return sendError(reply, 404, "no image set for this variant")
			}

			const ext = extname(imagePath).toLowerCase()
			const contentType = extToContentType(ext)
			try {
				return await sendFile(reply, imagePath, {
					contentType,
					cacheControl: "private, max-age=60",
					conditional: { headers: req.headers },
				})
			} catch (err) {
				req.log.error({ err, id, variant }, "character image GET failed")
				return sendError(reply, 500, "could not read image")
			}
		},
	)

	app.put<{ Params: { id: string; variant: string } }>(
		"/api/characters/:id/images/:variant",
		{
			schema: {
				params: charImageParamsSchema,
				headers: uploadHeadersSchema,
			},
		},
		async (req, reply) => {
			const id = parseSafeIdParam(reply, req.params.id)
			if (id === undefined) return reply

			const variant = req.params.variant
			if (variant !== "avatar" && variant !== "fullbody") {
				return sendError(reply, 400, "variant must be avatar or fullbody")
			}

			const filenameHeader = req.headers["x-filename"]
			const rawFilename =
				typeof filenameHeader === "string" ? filenameHeader : undefined
			if (rawFilename === undefined || rawFilename.length === 0) {
				return sendError(reply, 400, "X-Filename header is required")
			}

			const ext = extname(rawFilename).toLowerCase()
			if (!IMAGE_EXTENSIONS.has(ext)) {
				return sendError(
					reply,
					415,
					`unsupported image extension: ${ext}`,
					"character.upload_unsupported",
				)
			}

			if (!isOctetStream(req.headers["content-type"])) {
				return sendError(
					reply,
					415,
					"upload must be application/octet-stream",
					"character.upload_bad_content_type",
				)
			}

			const declaredLen = Number(req.headers["content-length"])
			if (Number.isFinite(declaredLen) && declaredLen > env.MAX_UPLOAD_BYTES) {
				return sendError(
					reply,
					413,
					"upload exceeds maximum size",
					"character.upload_too_large",
				)
			}

			try {
				await service.detail(id)
			} catch (err) {
				return domainErrorToHttp(reply, err)
			}

			// Stream the upload body into a temp file under local/cache/tmp. The
			// service copies it into the current-version character folder via
			// writeVersioned; we never write directly to versions/ from the HTTP layer.
			const tmpDir = join(paths.local.tmp(), "char-uploads")
			await mkdir(tmpDir, { recursive: true })
			const tmpPath = join(tmpDir, `char-${id}-${variant}-${Date.now()}${ext}`)
			const limiter = makeByteLimiter(env.MAX_UPLOAD_BYTES)
			try {
				await pipeline(req.raw, limiter, createWriteStream(tmpPath))
			} catch (err) {
				await rm(tmpPath, { force: true }).catch(() => {})
				if (err instanceof UploadTooLargeError) {
					return sendError(
						reply,
						413,
						"upload exceeds maximum size",
						"character.upload_too_large",
					)
				}
				req.log.error({ err }, "character image upload stream failed")
				return sendError(reply, 500, "upload failed")
			}

			try {
				await service.setImage(id, variant, ext, tmpPath)
			} catch (err) {
				await rm(tmpPath, { force: true }).catch(() => {})
				return domainErrorToHttp(reply, err)
			}

			// Best-effort cleanup of the temp source; the file has been copied.
			await rm(tmpPath, { force: true }).catch(() => {})

			reply.code(201)
			return { path: `/api/characters/${id}/images/${variant}` }
		},
	)

	app.delete<{ Params: { id: string; variant: string } }>(
		"/api/characters/:id/images/:variant",
		{ schema: { params: charImageParamsSchema } },
		async (req, reply) => {
			const id = parseSafeIdParam(reply, req.params.id)
			if (id === undefined) return reply

			const variant = req.params.variant
			if (variant !== "avatar" && variant !== "fullbody") {
				return sendError(reply, 400, "variant must be avatar or fullbody")
			}

			try {
				await service.clearImage(id, variant)
			} catch (err) {
				return domainErrorToHttp(reply, err)
			}

			reply.code(204)
			return reply.send()
		},
	)
}

export const charFilesPlugin = charFilesPluginImpl satisfies FastifyPluginAsync

function isOctetStream(value: string | undefined): boolean {
	if (value === undefined) return false
	const semi = value.indexOf(";")
	const head = (semi === -1 ? value : value.slice(0, semi)).trim().toLowerCase()
	return head === "application/octet-stream"
}

class UploadTooLargeError extends Error {
	constructor() {
		super("upload exceeds maximum size")
		this.name = "UploadTooLargeError"
	}
}

function makeByteLimiter(maxBytes: number): Transform {
	let seen = 0
	return new Transform({
		transform(chunk: Buffer, _enc, cb) {
			seen += chunk.length
			if (seen > maxBytes) {
				cb(new UploadTooLargeError())
				return
			}
			cb(null, chunk)
		},
	})
}
