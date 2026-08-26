import { prefKeys } from "./keys"

/**
 * Desktop-only "last route" restore.
 *
 * The SPA writes the resolved route as the user navigates; when the shell
 * creates a fresh window (tray reopen, relaunch), the boot arms a one-shot
 * restore so the first authenticated match on `/` redirects to the last
 * page instead of the overview. The flag is consumed at that match, so
 * later "Home" clicks never bounce back. The value is cleared on sign-out
 * and on a hard client reset (which wipes localStorage entirely).
 */

const MAX_LAST_ROUTE_LENGTH = 1024

/** Consumed once per boot by the `/` route's `beforeLoad`. */
let armedRestore: string | undefined

/** True after {@link armLastRouteRestore} armed a restore for this boot. */
export function isRestoreArmed(): boolean {
	return armedRestore !== undefined
}

export function writeLastRoute(href: string): void {
	if (href.length === 0 || href.length > MAX_LAST_ROUTE_LENGTH) return
	try {
		localStorage.setItem(prefKeys.lastRoute, href)
	} catch {
		// best-effort (private mode / full storage)
	}
}

export function readLastRoute(): string | undefined {
	try {
		const value = localStorage.getItem(prefKeys.lastRoute)
		return value === null || value.length === 0 ? undefined : value
	} catch {
		return undefined
	}
}

export function clearLastRoute(): void {
	armedRestore = undefined
	try {
		localStorage.removeItem(prefKeys.lastRoute)
	} catch {
		// best-effort
	}
}

/**
 * Read, validate, and arm the boot restore (desktop only, once at boot).
 * Invalid values — `/login`, unknown paths, junk — are cleared without
 * arming so a stale entry can never redirect into a blank page.
 */
export function armLastRouteRestore(patterns: readonly string[]): void {
	const stored = readLastRoute()
	if (stored === undefined) return
	if (!isRestorablePath(stored, patterns)) {
		clearLastRoute()
		return
	}
	armedRestore = stored
}

/** Take (and disarm) the boot restore, or `undefined` when none is armed. */
export function consumeLastRouteRestore(): string | undefined {
	const value = armedRestore
	armedRestore = undefined
	return value
}

/**
 * Whether a stored route may be restored: a pathname on `/login` is never
 * a "last page", and the path must match a registered route pattern where
 * `$` segments wildcard one segment (`/documents/$id` matches
 * `/documents/12`, not `/documents` or `/documents/12/x`).
 */
export function isRestorablePath(
	href: string,
	patterns: readonly string[],
): boolean {
	if (href.length > MAX_LAST_ROUTE_LENGTH) return false
	if (!href.startsWith("/")) return false
	const pathname = pathnameOf(href)
	if (pathname === "/login") return false
	return patterns.some((pattern) => matchesRoutePath(pathname, pattern))
}

function pathnameOf(href: string): string {
	try {
		return new URL(href, "http://hoardodile.local").pathname
	} catch {
		return href.split("?")[0] ?? ""
	}
}

function matchesRoutePath(pathname: string, pattern: string): boolean {
	const path = normalizeLeadingSlash(pathname)
	const patternSegments = pattern.split("/").filter(Boolean)
	const pathSegments = path.split("/").filter(Boolean)
	if (patternSegments.length === 0) return pathSegments.length === 0
	if (patternSegments.length !== pathSegments.length) return false
	return patternSegments.every((segment, index) => {
		if (segment.startsWith("$")) return pathSegments[index] !== undefined
		return segment === pathSegments[index]
	})
}

function normalizeLeadingSlash(pathname: string): string {
	return pathname.startsWith("/") ? pathname : `/${pathname}`
}
