import {
	clearStaleWebShellCaches,
	type StaleWebShellSession,
} from "./shell-cache.ts"
import { appUrlPreservingRoute } from "./urls.ts"

/**
 * The window slice a reload needs: its current URL and the navigation
 * primitives. Structural (not `BrowserWindow`) so the reload decision — and
 * the cache-clearing invariant it carries — is unit-testable without
 * Electron. `reload` is optional and unused: it exists so a regression back
 * to a cache-reusing reload stays both assignable and assertable.
 */
export type ReloadableWindow = {
	readonly webContents: {
		getURL: () => string
		loadURL: (url: string) => Promise<void>
		reloadIgnoringCache: () => void
		readonly reload?: () => void
	}
}

export type ReloadAppWindowDeps = {
	readonly win: ReloadableWindow
	/** What the sidecar serves now (its final port after the restart). */
	readonly sidecarUrl: string | undefined
	readonly session: StaleWebShellSession
}

/**
 * Reload the app window after the sidecar restarted with a newly applied
 * resource pack.
 *
 * Two concerns share one path:
 *
 * 1. **The endpoint may have moved.** A restarted sidecar can land on a
 *    different port (its predecessor's sockets linger between stop and
 *    rebind, e.g. TIME_WAIT on Windows), and a bare `reload()` would retry
 *    the stale URL and park the window on the shell error page. When the
 *    window is not already on the sidecar's URL, navigate to it while
 *    carrying the SPA route over — the session cookie is host-scoped
 *    (127.0.0.1), so a port change keeps the user signed in.
 *
 * 2. **The caches must not replay the old shell.** The pack replaced the web
 *    build under an unchanged origin, so the HTTP disk cache (and any
 *    leftover service-worker storage) could answer the reload with the
 *    previous bundle, showing the user the old UI until they refresh by
 *    hand. The cache-like session storages are dropped first and the
 *    same-URL load ignores the HTTP cache. Cookies, localStorage and
 *    IndexedDB are user data and stay untouched (see
 *    {@link clearStaleWebShellCaches}).
 */
export async function reloadAppWindow(
	deps: ReloadAppWindowDeps,
): Promise<void> {
	const { win, sidecarUrl, session } = deps
	const currentUrl = win.webContents.getURL()
	await clearStaleWebShellCaches(session)
	if (sidecarUrl !== undefined && currentUrl !== sidecarUrl) {
		// A failed load falls through to the in-window error page + Retry.
		await win.webContents
			.loadURL(appUrlPreservingRoute(currentUrl, sidecarUrl))
			.catch(() => undefined)
		return
	}
	win.webContents.reloadIgnoringCache()
}
