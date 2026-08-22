/**
 * Error thrown by {@link jsonFetch} when the HTTP status indicates failure.
 * Callers inspect `.status` to branch on specific cases (e.g. 401 → route
 * guards, 409 → toast conflict) without parsing the generic message.
 */
export class HttpError extends Error {
	readonly status: number

	constructor(status: number, message: string) {
		super(message)
		this.name = "HttpError"
		this.status = status
	}
}

/**
 * Every request is sent with cookies so the httpOnly session travels through the
 * Vite dev proxy and, in production, hits the co-located Fastify server.
 */
export function credentialedFetch(
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
): Promise<Response> {
	return fetch(input, { ...init, credentials: "include" })
}

/**
 * Low-level fetch wrapper that always includes credentials.
 * Returns the raw {@link Response} so callers can handle status codes,
 * blobs, or streaming bodies themselves.
 */
export async function apiFetch(
	input: string,
	init?: RequestInit,
): Promise<Response> {
	return credentialedFetch(input, init)
}

/**
 * Convenience wrapper for HTTP DELETE.
 */
export async function apiDelete(input: string): Promise<Response> {
	return credentialedFetch(input, { method: "DELETE" })
}

/**
 * Upload a raw blob via HTTP PUT with the headers the server expects for
 * cover / image uploads.
 */
export async function apiPutBlob(
	input: string,
	blob: Blob,
	filename: string,
	contentType?: string,
): Promise<Response> {
	return credentialedFetch(input, {
		method: "PUT",
		credentials: "include",
		headers: {
			"content-type": contentType ?? "application/octet-stream",
			"x-filename": filename,
		},
		body: blob,
	})
}

/**
 * Fetch that parses JSON on success and throws {@link HttpError} on any
 * non-2xx response. Always sends session cookies and an appropriate
 * `content-type` / `accept` so every raw-HTTP call site stays consistent.
 *
 * The response body is parsed opportunistically: empty bodies become
 * `undefined`, and the `error` field (if any) feeds the thrown message.
 */
export async function jsonFetch(
	input: string,
	init: RequestInit = {},
): Promise<unknown> {
	const response = await credentialedFetch(input, {
		...init,
		headers: {
			"content-type": "application/json",
			accept: "application/json",
			...(init.headers ?? {}),
		},
	})
	const text = await response.text()
	const body: unknown = text.length > 0 ? JSON.parse(text) : undefined
	if (!response.ok) {
		const message =
			body !== undefined &&
			body !== null &&
			typeof body === "object" &&
			"error" in body
				? String(body.error)
				: response.statusText
		throw new HttpError(response.status, message)
	}
	return body
}
