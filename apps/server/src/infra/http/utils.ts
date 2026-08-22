import { type DomainError, isDomainError } from "@hoardodile/shared"
import type { FastifyReply } from "fastify"
import { assertSafeSegment } from "src/infra/storage/paths.ts"

/**
 * Send a JSON response with an explicit status code. Centralised so every
 * HTTP route plugin emits the same `application/json` content-type without
 * relying on Fastify's serializer auto-detection.
 */
export function sendJson(
	reply: FastifyReply,
	code: number,
	body: Record<string, unknown>,
): void {
	reply.code(code).type("application/json").send(body)
}

/**
 * Send a uniform error envelope: `{ error: message }` or, when a
 * domain-specific kind is available, `{ error: message, kind }`.
 */
export function sendError(
	reply: FastifyReply,
	code: number,
	message: string,
	kind?: string,
): FastifyReply {
	sendJson(
		reply,
		code,
		kind !== undefined ? { error: message, kind } : { error: message },
	)
	return reply
}

/**
 * Map a thrown service-layer error onto an HTTP response. A `DomainError`
 * (raised directly, or wrapped on an `Error.cause` the way the plugin
 * sandbox surfaces domain failures) carries a stable `code` discriminant
 * that selects the status code; `kind` passes through so the client can
 * localise. Anything else is logged and surfaces as a generic 500.
 *
 * The optional `notFoundKind` lets callers brand the `kind` on `NOT_FOUND`
 * so the client can localise the message.
 *
 * @param reply - Fastify reply to send through.
 * @param err - Caught error, expected to be a `DomainError` for the typed branches.
 * @param opts - Optional overrides for the mapping.
 */
export function domainErrorToHttp(
	reply: FastifyReply,
	err: unknown,
	opts?: { readonly notFoundKind?: string },
): FastifyReply {
	const domain = unwrapDomainError(err)
	if (domain !== undefined) {
		const { code, kind, message } = domain
		switch (code) {
			case "NOT_FOUND":
				return sendError(reply, 404, message, opts?.notFoundKind ?? kind)
			case "VALIDATION":
				return sendError(reply, 400, message, kind)
			case "FORBIDDEN":
				return sendError(reply, 403, message, kind)
			case "CONFLICT":
				return sendError(reply, 409, message, kind)
			case "UNAUTHORIZED":
				return sendError(reply, 401, message, kind)
			case "RATE_LIMITED":
				return sendError(reply, 429, message, kind)
			case "UNSUPPORTED":
				return sendError(reply, 415, message, kind)
		}
	}
	reply.log.error({ err }, "request failed")
	return sendError(reply, 500, "internal error")
}

function unwrapDomainError(err: unknown): DomainError | undefined {
	if (isDomainError(err)) return err
	// The plugin sandbox can wrap a domain failure in a transport error;
	// read through the cause chain so the code table still applies.
	if (err instanceof Error && isDomainError(err.cause)) return err.cause
	return undefined
}

/**
 * Parse a path-parameter `id` through {@link assertSafeSegment}. Returns
 * `undefined` and writes a 400 response when the segment is unsafe, so
 * route handlers can short-circuit with `if (id === undefined) return reply`.
 */
export function parseSafeIdParam(
	reply: FastifyReply,
	raw: string,
): string | undefined {
	try {
		return assertSafeSegment(raw)
	} catch (err) {
		sendError(
			reply,
			400,
			err instanceof Error ? err.message : "invalid path segment",
		)
		return undefined
	}
}

export const resThumbParamsSchema = {
	type: "object",
	properties: {
		id: { type: "string", minLength: 1, maxLength: 255 },
	},
	required: ["id"],
} as const

/**
 * Map a {@link ThumbFormat} onto its IANA media type so route handlers
 * can set `content-type` without an inline ternary.
 */
export function imageFormatContentType(format: "webp" | "avif"): string {
	return format === "avif" ? "image/avif" : "image/webp"
}

/**
 * Map a file extension (with or without leading dot) to its IANA media type.
 * Covers the still-image formats accepted for character images and plugin
 * assets, plus the video/audio formats the cover endpoint passes through.
 * Falls back to `application/octet-stream` for unknown extensions.
 */
export function extToContentType(ext: string): string {
	const e = ext.startsWith(".") ? ext.slice(1) : ext
	switch (e) {
		case "jpg":
		case "jpeg":
			return "image/jpeg"
		case "png":
			return "image/png"
		case "webp":
			return "image/webp"
		case "gif":
			return "image/gif"
		case "bmp":
			return "image/bmp"
		case "avif":
			return "image/avif"
		case "webm":
			return "video/webm"
		case "mp4":
			return "video/mp4"
		case "mp3":
			return "audio/mpeg"
		case "flac":
			return "audio/flac"
		case "ogg":
		case "opus":
			return "audio/ogg"
		case "m4a":
			return "audio/mp4"
		case "wav":
			return "audio/wav"
		default:
			return "application/octet-stream"
	}
}
