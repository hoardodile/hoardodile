/**
 * Session-scoped scroll memory for tracked routes.
 *
 * The whole app scrolls inside AppShell's single `[data-app-scroll]`
 * container, so TanStack Router's built-in (window-only) scroll
 * restoration is a no-op here. We keep one `scrollTop` per
 * `pathname + search` in sessionStorage: refreshed pages and back /
 * forward navigations return to where the user left off.
 *
 * Routes with their own position mechanisms — the document reader
 * (`/documents/$id`, persisted per-doc) and plugin readers
 * (`/resources/$id`, plugin-managed via `pluginState`) — are excluded so
 * the two mechanisms never fight over the same container.
 */

const SESSION_PREFIX = "hoardodile.scroll"

const SKIPPED_ROUTE_PREFIXES = ["/documents/$id", "/resources/$id"] as const

/** Whether a route manages its own scroll position (and must be left alone). */
export function isRouteScrollTracked(routeId: string): boolean {
	return !SKIPPED_ROUTE_PREFIXES.some((prefix) => routeId.startsWith(prefix))
}

export function routeScrollKey(pathname: string, searchStr: string): string {
	return `${SESSION_PREFIX}:${pathname}${searchStr}`
}

export function readRouteScroll(key: string): number | undefined {
	try {
		const raw = sessionStorage.getItem(key)
		if (raw === null) return undefined
		const value = Number(raw)
		return Number.isFinite(value) && value >= 0 ? value : undefined
	} catch {
		return undefined
	}
}

export function writeRouteScroll(key: string, top: number): void {
	try {
		sessionStorage.setItem(key, String(top))
	} catch {
		// Quota / privacy-mode errors: best-effort only.
	}
}
