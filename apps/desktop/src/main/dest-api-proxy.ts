import { net, session } from "electron"

const API_PREFIXES = ["/trpc", "/auth", "/api", "/health"] as const

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
		const target = destApiProxyTarget(request.url, spaOrigin, sidecarOrigin)
		if (target === undefined) {
			return net.fetch(request, { bypassCustomProtocolHandlers: true })
		}
		return forwardToSidecar(request, target)
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

function forwardToSidecar(request: Request, target: string): Promise<Response> {
	return net.fetch(new Request(target, request), {
		bypassCustomProtocolHandlers: true,
	})
}
