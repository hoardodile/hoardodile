import { STATUS_CODES } from "node:http"

export type SafeErrorBody = {
	readonly statusCode: number
	readonly error: string
	readonly message: string
	readonly code?: string
	readonly validation?: unknown
}

/**
 * Build the HTTP error body that reaches a client. Server-side failures
 * (status >= 500) are masked so an internal message — the default Fastify
 * body would echo `error.message`, which can carry an absolute filesystem
 * path (e.g. an `ENOENT` `stat`) — and `error.code` (e.g. `ENOENT`) never
 * leak over the wire. 4xx responses keep their client-facing `message` and
 * any `code`/`validation` so validation and auth errors stay informative.
 *
 * The full detail is still logged server-side by Fastify; this only shapes
 * the response body.
 */
export function toSafeErrorBody(error: {
	readonly statusCode?: number
	readonly code?: string
	readonly message?: string
	readonly validation?: unknown
}): SafeErrorBody {
	const statusCode = error.statusCode ?? 500
	const label = STATUS_CODES[statusCode] ?? "Internal Server Error"
	if (statusCode >= 500) {
		return { statusCode, error: label, message: "Internal Server Error" }
	}
	return {
		statusCode,
		error: label,
		message: error.message ?? "",
		...(error.code !== undefined ? { code: error.code } : {}),
		...(error.validation !== undefined ? { validation: error.validation } : {}),
	}
}
