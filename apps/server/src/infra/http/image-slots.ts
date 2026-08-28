import { createWriteStream } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { extname, join } from "node:path"
import { Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import { IMAGE_EXTS } from "@hoardodile/sdk-types/media-exts"
import type { FastifyInstance } from "fastify"
import type { ThumbService } from "src/infra/thumb/service.ts"
import { sendFile } from "./conditional-request.ts"
import {
	domainErrorToHttp,
	extToContentType,
	imageFormatContentType,
	parseSafeIdParam,
	sendError,
	sendJson,
} from "./utils.ts"

/**
 * The shared image-extension set: slot uploads accept every still-image
 * format the thumbnail pipeline decodes (see
 * `@hoardodile/sdk-types/media-exts`), keeping the gate in one place.
 */
const IMAGE_EXTENSIONS = IMAGE_EXTS

/**
 * Service contract the factory needs. Character and tag services both
 * expose these four operations for their slots (`avatar`/`fullbody`,
 * `image` respectively), so the HTTP layer stays uniform.
 */
export type ImageSlotService = {
	/** Resolve the archive version pointer recorded for the slot. */
	getVariantVersion(id: string, slot: string): Promise<number>
	/** Resolve the on-disk slot file path, or `undefined` when unset. */
	resolveImagePath(id: string, slot: string): Promise<string | undefined>
	/** Install a slot image from a validated temp source file. */
	setImage(
		id: string,
		slot: string,
		ext: string,
		sourcePath: string,
	): Promise<unknown>
	/** Remove the slot image under the current version. */
	clearImage(id: string, slot: string): Promise<unknown>
}

export type ImageSlotRoutesOptions = {
	/** Subject used for thumb rendering and cache folders. */
	readonly subjectKind: "character" | "tag"
	/** URL prefix without the `:id` segment, e.g. `/api/characters`. */
	readonly basePath: string
	/** The slot name discriminator for this subject, e.g. `["avatar", "fullbody"]`. */
	readonly slots: readonly string[]
	/** Error `kind` discriminator for client localisation, e.g. `"character"`. */
	readonly errorKind: string
	readonly service: ImageSlotService
	readonly thumbs: Pick<ThumbService, "getSlotImageThumb">
	/** Per-slot render area cap, e.g. `CHARACTER_AVATAR_MAX_AREA`. */
	readonly thumbMaxAreaOf: (slot: string) => number
	/**
	 * Which route families to register. A subject registers all of them
	 * once; existing per-route plugins (characters) split the families
	 * across two registration points so the fastify plugin graph stays
	 * unchanged. Defaults to both.
	 */
	readonly routeFamilies?: readonly ("images" | "thumb")[]
}

/**
 * Fastify plugin factory registering the four raw-HTTP image-slot routes
 * shared by every subject with user-managed slot images (characters,
 * tags):
 *
 *   GET    {base}/:id/images/:slot  -- original image (404 when unset)
 *   PUT    {base}/:id/images/:slot  -- upload (octet-stream, X-Filename)
 *   DELETE {base}/:id/images/:slot  -- remove
 *   GET    {base}/:id/thumb/:slot   -- cached preview-size avif (404 when unset)
 *
 * `slot` must be one of `opts.slots`. The upload body must be
 * `application/octet-stream`; the filename (and thus extension) is taken
 * from the `X-Filename` request header so the route URL stays clean.
 *
 * The actual file writes are delegated to `opts.service.setImage` /
 * `opts.service.clearImage`, which route through `writeVersioned` so the
 * bytes always land under `paths.latest` and the read-only archive gate
 * is respected. The HTTP layer only validates transport concerns and
 * streams the body into a temporary file.
 */
export function registerImageSlotRoutes(
	app: FastifyInstance,
	opts: ImageSlotRoutesOptions,
): void {
	const env = app.env
	const { subjectKind, basePath, slots, errorKind, service, thumbs } = opts
	const families = new Set(opts.routeFamilies ?? (["images", "thumb"] as const))
	const registerImages = families.has("images")
	const registerThumb = families.has("thumb")

	function isSlot(value: string): value is (typeof slots)[number] {
		return slots.includes(value)
	}

	const paramsSchema = {
		type: "object",
		properties: {
			id: { type: "string", minLength: 1, maxLength: 255 },
			slot: { type: "string", enum: slots },
		},
		required: ["id", "slot"],
	} as const

	const uploadHeadersSchema = {
		type: "object",
		properties: {
			"content-type": { type: "string", minLength: 1 },
			"x-filename": { type: "string", minLength: 1, maxLength: 255 },
		},
		required: ["content-type", "x-filename"],
	} as const

	if (registerImages) {
		app.get<{ Params: { id: string; slot: string } }>(
			`${basePath}/:id/images/:slot`,
			{
				schema: { params: paramsSchema },
				config: { readOnlySafe: true },
			},
			async (req, reply) => {
				const id = parseSafeIdParam(reply, req.params.id)
				if (id === undefined) return reply

				const slot = req.params.slot
				if (!isSlot(slot)) {
					return sendError(
						reply,
						400,
						`slot must be one of ${slots.join(", ")}`,
					)
				}

				let imagePath: string | undefined
				try {
					imagePath = await service.resolveImagePath(id, slot)
				} catch (err) {
					return domainErrorToHttp(reply, err)
				}

				if (imagePath === undefined) {
					return sendError(reply, 404, "no image set for this slot")
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
					req.log.error({ err, id, slot }, "slot image GET failed")
					return sendError(reply, 500, "could not read image")
				}
			},
		)

		app.put<{ Params: { id: string; slot: string } }>(
			`${basePath}/:id/images/:slot`,
			{
				schema: {
					params: paramsSchema,
					headers: uploadHeadersSchema,
				},
			},
			async (req, reply) => {
				const id = parseSafeIdParam(reply, req.params.id)
				if (id === undefined) return reply

				const slot = req.params.slot
				if (!isSlot(slot)) {
					return sendError(
						reply,
						400,
						`slot must be one of ${slots.join(", ")}`,
					)
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
						`${errorKind}.upload_unsupported`,
					)
				}

				if (!isOctetStream(req.headers["content-type"])) {
					return sendError(
						reply,
						415,
						"upload must be application/octet-stream",
						`${errorKind}.upload_bad_content_type`,
					)
				}

				const declaredLen = Number(req.headers["content-length"])
				if (
					Number.isFinite(declaredLen) &&
					declaredLen > env.MAX_UPLOAD_BYTES
				) {
					return sendError(
						reply,
						413,
						"upload exceeds maximum size",
						`${errorKind}.upload_too_large`,
					)
				}

				try {
					await service.getVariantVersion(id, slot)
				} catch (err) {
					return domainErrorToHttp(reply, err)
				}

				// Stream the upload body into a temp file under local/cache/tmp.
				// The service copies it into the current-version subject folder
				// via writeVersioned; we never write directly to versions/ from
				// the HTTP layer.
				const tmpDir = join(app.paths.local.tmp(), "slot-uploads")
				await mkdir(tmpDir, { recursive: true })
				const tmpPath = join(
					tmpDir,
					`${errorKind}-${id}-${slot}-${Date.now()}${ext}`,
				)
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
							`${errorKind}.upload_too_large`,
						)
					}
					req.log.error({ err }, "slot image upload stream failed")
					return sendError(reply, 500, "upload failed")
				}

				try {
					await service.setImage(id, slot, ext, tmpPath)
				} catch (err) {
					await rm(tmpPath, { force: true }).catch(() => {})
					return domainErrorToHttp(reply, err)
				}

				// Best-effort cleanup of the temp source; the file has been copied.
				await rm(tmpPath, { force: true }).catch(() => {})

				return sendJson(reply, 201, {
					path: `${basePath}/${id}/images/${slot}`,
				})
			},
		)

		app.delete<{ Params: { id: string; slot: string } }>(
			`${basePath}/:id/images/:slot`,
			{ schema: { params: paramsSchema } },
			async (req, reply) => {
				const id = parseSafeIdParam(reply, req.params.id)
				if (id === undefined) return reply

				const slot = req.params.slot
				if (!isSlot(slot)) {
					return sendError(
						reply,
						400,
						`slot must be one of ${slots.join(", ")}`,
					)
				}

				try {
					await service.clearImage(id, slot)
				} catch (err) {
					return domainErrorToHttp(reply, err)
				}

				reply.code(204)
				return reply.send()
			},
		)
	}

	if (registerThumb) {
		app.get<{ Params: { id: string; slot: string } }>(
			`${basePath}/:id/thumb/:slot`,
			{
				schema: { params: paramsSchema },
				config: { readOnlySafe: true },
			},
			async (req, reply) => {
				const id = parseSafeIdParam(reply, req.params.id)
				if (id === undefined) return reply

				const slot = req.params.slot
				if (!isSlot(slot)) {
					return sendError(
						reply,
						400,
						`slot must be one of ${slots.join(", ")}`,
					)
				}
				let version: number
				try {
					version = await service.getVariantVersion(id, slot)
				} catch (err) {
					return domainErrorToHttp(reply, err)
				}
				try {
					const result = await thumbs.getSlotImageThumb(
						subjectKind,
						id,
						slot,
						version,
						opts.thumbMaxAreaOf(slot),
					)
					if (result.kind === "unavailable") {
						return sendJson(reply, 404, { error: "no image" })
					}
					return sendFile(reply, result.path, {
						contentType: imageFormatContentType(result.format),
						cacheControl: "private, max-age=60",
						conditional: { headers: req.headers },
					})
				} catch (err) {
					req.log.error({ err, id }, "slot thumb synth failed")
					return sendJson(reply, 500, { error: "thumb synth failed" })
				}
			},
		)
	}
}

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
