import { timingSafeEqual } from "node:crypto"
import type { FastifyInstance, FastifyRequest } from "fastify"
import "src/infra/fastify-augment.ts"

/**
 * Whether the request arrived over a loopback connection. Desktop control
 * routes are only ever called by the shell on the same machine; when the
 * sidecar listens on `0.0.0.0` (local-network sharing) the token gate
 * alone would still expose them to the LAN, so control routes reject
 * non-loopback peers outright.
 */
export function isLoopbackRequest(request: {
	readonly socket: { readonly remoteAddress?: string | undefined }
}): boolean {
	const remote = request.socket.remoteAddress
	return (
		remote === "127.0.0.1" || remote === "::1" || remote === "::ffff:127.0.0.1"
	)
}

/**
 * Accept a sidecar control request when `HOARDODILE_SHUTDOWN_TOKEN` is
 * set and matches the `x-shutdown-token` header or JSON `token` body.
 * Unset token (self-host) always fails.
 */
export function authorizeSidecarToken(
	app: FastifyInstance,
	request: FastifyRequest,
): boolean {
	const expected = app.env.HOARDODILE_SHUTDOWN_TOKEN
	const provided = readProvidedToken(request)
	return (
		expected !== undefined &&
		provided !== undefined &&
		tokensEqual(expected, provided)
	)
}

function readProvidedToken(request: FastifyRequest): string | undefined {
	const header = request.headers["x-shutdown-token"]
	if (typeof header === "string" && header.length > 0) return header
	const body = request.body
	if (isRecord(body)) {
		const token = body.token
		if (typeof token === "string" && token.length > 0) return token
	}
	return undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function tokensEqual(expected: string, provided: string): boolean {
	const a = Buffer.from(expected)
	const b = Buffer.from(provided)
	if (a.length !== b.length) return false
	return timingSafeEqual(a, b)
}
