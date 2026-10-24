/**
 * Error thrown by {@link jsonFetch} when the HTTP status indicates failure.
 * Callers inspect `.status` to branch on specific cases (e.g. 401 → route
 * guards, 409 → toast conflict) without parsing the generic message.
 */
import {
	isExplicitlySignedOut,
	isSessionLocked,
	lockSession,
	needsUnlock,
	renewSession,
	sessionGeneration,
	sessionMode,
	sessionToken,
} from "@/features/auth/session"

export class HttpError extends Error {
	readonly status: number

	constructor(status: number, message: string) {
		super(message)
		this.name = "HttpError"
		this.status = status
	}
}

/**
 * Same-origin transport for cookie sessions and page-only bearer credentials.
 * Locked pages cannot use either transport to fetch private content.
 */
export async function credentialedFetch(
	input: Parameters<typeof fetch>[0],
	init?: Parameters<typeof fetch>[1],
): Promise<Response> {
	const href =
		typeof input === "string"
			? input
			: input instanceof URL
				? input.href
				: input.url
	const requestUrl = new URL(
		href,
		typeof window === "undefined" ? "http://localhost" : window.location.origin,
	)
	const origin =
		typeof window === "undefined" ? "http://localhost" : window.location.origin
	if (requestUrl.origin !== origin)
		throw new HttpError(400, "Cross-origin authenticated request refused")
	const pathname = requestUrl.pathname
	const authEndpoint = /^\/auth\/(?:status|login|unlock|setup|logout)$/.test(
		pathname,
	)
	if (
		!authEndpoint &&
		(isSessionLocked() || (sessionMode() === "page" && !sessionToken()))
	)
		throw new HttpError(401, "locked")
	const headers = new Headers(
		init?.headers ?? (input instanceof Request ? input.headers : undefined),
	)
	const credentialEndpoint = /^\/auth\/(?:login|unlock|setup|logout)$/.test(
		pathname,
	)
	const page =
		sessionMode() === "page" ||
		(!credentialEndpoint && (isSessionLocked() || isExplicitlySignedOut()))
	const credential = sessionToken()
	if (page) {
		headers.set("x-hoardodile-session-mode", "page")
		if (credential) headers.set("authorization", `Bearer ${credential}`)
	}
	const requestGeneration = sessionGeneration()
	const response = await fetch(input, {
		...init,
		headers,
		credentials: page ? "omit" : "include",
	})
	const renewed = response.headers.get("x-hoardodile-session")
	if (renewed) renewSession(renewed, requestGeneration)
	if (
		!authEndpoint &&
		response.status === 401 &&
		needsUnlock() &&
		typeof window !== "undefined"
	)
		lockSession(
			window.location.pathname + window.location.search + window.location.hash,
		)
	if (!authEndpoint && requestGeneration !== sessionGeneration())
		throw new HttpError(401, "locked")
	return response
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
