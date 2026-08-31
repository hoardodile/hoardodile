export type WindowOpenDecision = "same-window" | "external" | "deny"

/**
 * Navigation policy for the shell's `setWindowOpenHandler` / `will-navigate`.
 *
 * App windows: a URL replaces the app window only when it keeps the app
 * origin AND targets a real SPA route (path patterns registered by the SPA
 * itself at boot). Every other http(s) goes to the OS browser, so a stray
 * link — `/LICENSE`, `/api/...`, another localhost service, a future
 * extension adding a link somewhere — can never clobber the app. Non-http
 * schemes are dropped.
 *
 * Wizard windows keep the original loopback rule: the wizard is a static
 * single page with no links, so there is nothing to protect there.
 */
export function isLocalhostHttp(url: string): boolean {
	try {
		const parsed = new URL(url)
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return false
		}
		return isLoopbackHostname(parsed.hostname)
	} catch {
		return false
	}
}

function isLoopbackHostname(hostname: string): boolean {
	switch (hostname) {
		case "127.0.0.1":
		case "localhost":
		case "[::1]":
			return true
		default:
			return false
	}
}

/** Parse as http(s) URL. */
function tryParseHttp(url: string): URL | undefined {
	try {
		const parsed = new URL(url)
		if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
			return undefined
		}
		return parsed
	} catch {
		return undefined
	}
}

/**
 * Whether `url` and `currentUrl` share the app origin. `localhost` and
 * `127.0.0.1` are treated as the same host only when both sides are
 * loopback — both name the same bound service, and the equivalent port
 * guarantees they cannot be a different server.
 */
function sameAppOrigin(url: URL, currentUrl: URL): boolean {
	if (url.protocol !== currentUrl.protocol) return false
	if (url.port !== currentUrl.port) return false
	if (
		isLoopbackHostname(url.hostname) &&
		isLoopbackHostname(currentUrl.hostname)
	) {
		return true
	}
	return url.hostname === currentUrl.hostname
}

/**
 * Whether `pathname` matches one of the SPA's registered route path
 * patterns. Match is segment-wise: `$`-prefixed pattern segments match any
 * single decoded segment, so `/characters/$id` matches `/characters/r-1`.
 * Query/hash never reach this function (`URL.pathname`), and trailing
 * slashes are ignored — TanStack index routes report both `/characters` and
 * `/characters/` forms.
 */
export function matchesAppRoute(
	pathname: string,
	appRoutes: readonly string[],
): boolean {
	const path = trimTrailingSlash(pathname)
	for (const pattern of appRoutes) {
		if (patternMatches(trimTrailingSlash(pattern), path)) return true
	}
	return false
}

function patternMatches(pattern: string, path: string): boolean {
	if (pattern === "/") return path === "/"
	const patternSegs = splitPath(pattern)
	const pathSegs = splitPath(path)
	if (patternSegs.length !== pathSegs.length) return false
	return patternSegs.every((seg, index) => {
		if (seg.startsWith("$")) return true
		const pathSeg = pathSegs[index]
		return (
			pathSeg !== undefined && decodeSegment(seg) === decodeSegment(pathSeg)
		)
	})
}

function splitPath(path: string): string[] {
	return path.split("/").filter((seg) => seg.length > 0)
}

function trimTrailingSlash(path: string): string {
	if (path === "/") return "/"
	const trimmed = path.replace(/\/+$/, "")
	return trimmed.length > 0 ? trimmed : "/"
}

function decodeSegment(segment: string): string {
	try {
		return decodeURIComponent(segment)
	} catch {
		return segment
	}
}

/**
 * Target URL for reloading the app window into `appUrl` after a sidecar
 * change while keeping the SPA route: when the window is currently on the
 * app's loopback origin, carry its pathname/search/hash over so a reload
 * (LAN toggle, resource-swap apply, port drift) does not bounce the user
 * back to the index route. Non-app current URLs (`about:blank`, shell
 * pages, foreign hosts) fall back to the raw `appUrl` (its root).
 */
export function appUrlPreservingRoute(
	currentUrl: string,
	appUrl: string,
): string {
	const current = tryParseHttp(currentUrl)
	if (current === undefined || !isLoopbackHostname(current.hostname)) {
		return appUrl
	}
	const target = tryParseHttp(appUrl)
	if (target === undefined) return appUrl
	target.pathname = current.pathname
	target.search = current.search
	target.hash = current.hash
	return target.toString()
}

/**
 * App-window policy. `appRoutes` are the SPA route patterns registered via
 * the preload bridge; when the list is empty (SPA not yet booted, e.g. the
 * in-window error page) only the app root `/` may keep the window, and the
 * shell's own `loadURL` calls never pass through here anyway.
 */
export function appWindowDecision(
	url: string,
	currentUrl: string,
	appRoutes: readonly string[],
): WindowOpenDecision {
	const target = tryParseHttp(url)
	if (target === undefined) return "deny"
	const current = tryParseHttp(currentUrl)
	if (current === undefined) return "external"
	if (!sameAppOrigin(target, current)) return "external"
	if (appRoutes.length === 0)
		return trimTrailingSlash(target.pathname) === "/"
			? "same-window"
			: "external"
	if (matchesAppRoute(target.pathname, appRoutes)) return "same-window"
	return "external"
}

/**
 * Wizard-window policy: the historical loopback rule. The wizard is a
 * static single page with no links, so nothing needs tightening here.
 */
export function wizardWindowDecision(url: string): WindowOpenDecision {
	if (isLocalhostHttp(url)) return "same-window"
	if (url.startsWith("https:") || url.startsWith("http:")) return "external"
	return "deny"
}

export async function isHttpReachable(
	url: string,
	timeoutMs = 800,
): Promise<boolean> {
	try {
		await fetch(url, { signal: AbortSignal.timeout(timeoutMs) })
		return true
	} catch {
		return false
	}
}
