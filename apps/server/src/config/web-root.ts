import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

/**
 * Resolve the directory of pre-built web assets to serve at `/` from the
 * `APP_WEB_ROOT` override.
 *
 * The value is accepted only when it actually contains an SPA — that is,
 * when `index.html` is present inside it. A missing/stale build (a partial
 * `dist` left by an interrupted rebuild, or a build that was cleaned while
 * the sidecar kept running) must never be mounted, otherwise serving `/`
 * would `stat` a nonexistent `index.html` and surface a raw `ENOENT` 500
 * that leaks the absolute filesystem path to LAN clients.
 *
 * @param appWebRoot - The `APP_WEB_ROOT` env value (already absolute), or
 *   `undefined`/empty when not configured.
 * @returns The absolute web-assets directory when it has an `index.html`,
 *   or `undefined` so the caller falls through to the bundled web tree.
 */
export function resolveAppWebRoot(
	appWebRoot: string | undefined,
): string | undefined {
	if (appWebRoot === undefined || appWebRoot.length === 0) return undefined
	const resolved = resolve(appWebRoot)
	return existsSync(join(resolved, "index.html")) ? resolved : undefined
}
