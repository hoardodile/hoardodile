import {
	canWaitForStorage,
	STORAGE_COMMIT_TIMEOUT_MS,
} from "@hoardodile/shared/trpc-timeouts"
import { net, session } from "electron"

const API_PREFIXES = ["/trpc", "/auth", "/api", "/health"] as const

/**
 * Cap proxied fetches: a hung forward (e.g. a request whose page died
 * mid-navigation) must surface as a failure, not leave the renderer's
 * untimed-out fetch waiting forever. 15s is far beyond a healthy sidecar
 * round-trip.
 */
const PROXY_TIMEOUT_MS = 15_000

export type DestApiProxy = {
	setSidecarOrigin: (sidecarOrigin: string) => void
}

let installed: DestApiProxy | undefined

/**
 * Dest windows load the Vite SPA origin while the sidecar listens on
 * another port. Map same-origin API paths onto the sidecar URL so the
 * renderer can keep using relative `/trpc` `/auth` `/api` `/health`.
 * Privileged `/api/internal` stays on Vite (and never reaches the
 * token-gated sidecar routes from the renderer).
 */
export function destApiProxyTarget(
	requestUrl: string,
	spaOrigin: string,
	sidecarOrigin: string,
): string | undefined {
	const url = parseUrl(requestUrl)
	const spa = parseUrl(spaOrigin)
	const sidecar = parseUrl(sidecarOrigin)
	if (url === undefined || spa === undefined || sidecar === undefined) {
		return undefined
	}
	if (url.origin !== spa.origin) return undefined
	if (url.origin === sidecar.origin) return undefined
	const pathname = url.pathname
	if (pathname === "/api/internal" || pathname.startsWith("/api/internal/")) {
		return undefined
	}
	if (!matchesApiPrefix(pathname)) return undefined
	return new URL(`${pathname}${url.search}`, sidecar.origin).href
}

export function destSpaNeedsSidecarProxy(
	spaUrl: string,
	sidecarUrl: string,
): boolean {
	const spa = parseUrl(spaUrl)
	const sidecar = parseUrl(sidecarUrl)
	if (spa === undefined || sidecar === undefined) return false
	return spa.origin !== sidecar.origin
}

/**
 * Register `protocol.handle("http")` once. Later sidecar restarts only
 * update the closed-over origin. Packaged windows (SPA already on the
 * sidecar) must not call this.
 */
export function installDestApiProxy(options: {
	readonly spaOrigin: string
	readonly sidecarOrigin: string
}): DestApiProxy {
	if (installed !== undefined) {
		installed.setSidecarOrigin(options.sidecarOrigin)
		return installed
	}
	let sidecarOrigin = options.sidecarOrigin
	const spaOrigin = options.spaOrigin
	session.defaultSession.protocol.handle("http", (request) => {
		return proxyHttpRequest(request, spaOrigin, sidecarOrigin)
	})
	installed = {
		setSidecarOrigin(next) {
			sidecarOrigin = next
		},
	}
	return installed
}

export function bindDestApiProxy(options: {
	readonly packaged: boolean
	readonly spaUrl: string | undefined
	readonly sidecarUrl: string
}): void {
	if (options.packaged) return
	const spaUrl = options.spaUrl
	if (spaUrl === undefined || spaUrl.length === 0) return
	if (!destSpaNeedsSidecarProxy(spaUrl, options.sidecarUrl)) return
	installDestApiProxy({
		spaOrigin: spaUrl,
		sidecarOrigin: options.sidecarUrl,
	})
}

function matchesApiPrefix(pathname: string): boolean {
	for (const prefix of API_PREFIXES) {
		if (pathname === prefix || pathname.startsWith(`${prefix}/`)) return true
	}
	return false
}

function parseUrl(value: string): URL | undefined {
	try {
		return new URL(value)
	} catch {
		return undefined
	}
}

/**
 * Route one renderer request: SPA-origin API paths forward to the sidecar,
 * everything else passes through untouched.
 *
 * The two failure modes are deliberately different:
 * - Pass-through failures can be main-frame navigations (refresh while the
 *   dev server is down). A 502 body would be committed and painted as a
 *   bare "request failed" page (or flash) — fail the request with a
 *   network error (`Response.error()` → `net::ERR_FAILED`, the documented
 *   `protocol.handle` semantics) so the navigation lands in `did-fail-load`
 *   and the shell's in-window error page, with the previous page visible
 *   until it is replaced.
 * - Forward failures are API calls; a 502 keeps the renderer's request
 *   failure semantics identical (it still rejects as a network error, and
 *   the rejection is swallowed here so nothing prints an unhandled
 *   `net::ERR_*` during sidecar restarts).
 */
export async function proxyHttpRequest(
	request: Request,
	spaOrigin: string,
	sidecarOrigin: string,
): Promise<Response> {
	const target = destApiProxyTarget(request.url, spaOrigin, sidecarOrigin)
	if (target === undefined) {
		try {
			return await net.fetch(request, { bypassCustomProtocolHandlers: true })
		} catch {
			return Response.error()
		}
	}
	try {
		return await forwardToSidecar(request, target)
	} catch {
		return new Response("request failed", { status: 502 })
	}
}

/**
 * Forward a renderer API call to the sidecar with a hard timeout so a
 * hung forward surfaces as a failure instead of the renderer's
 * untimed-out fetch waiting forever.
 */
function forwardToSidecar(request: Request, target: string): Promise<Response> {
	return net.fetch(new Request(target, request), {
		bypassCustomProtocolHandlers: true,
		signal: AbortSignal.any([
			request.signal,
			AbortSignal.timeout(
				canWaitForStorage(target, request.method)
					? STORAGE_COMMIT_TIMEOUT_MS
					: PROXY_TIMEOUT_MS,
			),
		]),
	})
}
