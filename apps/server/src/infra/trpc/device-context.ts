import { AsyncLocalStorage } from "node:async_hooks"
import { type ClientPlatform, clientPlatform } from "@hoardodile/schemas"
import type { FastifyRequest } from "fastify"
import { z } from "zod"

const PLATFORM_HEADER = "x-platform"

/**
 * Ambient per-request device context. The web client tags every request
 * with its detected platform (`x-platform`); a Fastify `onRequest` hook
 * captures it here, and the trace service reads it when recording a
 * footprint — one wiring point, so domain services stay device-agnostic.
 */
const deviceContext = new AsyncLocalStorage<{
	readonly platform: ClientPlatform
}>()

/** Platform of the request being handled, or `web-pc` outside a request. */
export function getRequestPlatform(): ClientPlatform {
	return deviceContext.getStore()?.platform ?? "web-pc"
}

/** Run `fn` with the platform derived from the request's `x-platform` header. */
export function runWithDeviceContext<T>(
	req: Pick<FastifyRequest, "headers">,
	fn: () => T,
): T {
	const parsed = z
		.string()
		.pipe(clientPlatform)
		.safeParse(req.headers[PLATFORM_HEADER])
	const platform: ClientPlatform = parsed.success ? parsed.data : "web-pc"
	return deviceContext.run({ platform }, fn)
}
