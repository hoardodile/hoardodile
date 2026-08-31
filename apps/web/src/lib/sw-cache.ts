/**
 * Pure helpers for the app's resource-content cache (see `apps/web/src/sw.ts`).
 * Kept out of the service worker so the route matcher and the token-stripping
 * cache-key normalizer can be unit-tested without a worker or DOM context.
 *
 * These cover same-origin SPA requests to `/api/resources/<id>/files|frame|extracted/...`
 * (`CacheFirst`). NOTE: a content plugin's preview lives in a sandboxed,
 * opaque-origin iframe (no `allow-same-origin` — see
 * `apps/server/src/infra/http/plugin-render.ts` and
 * `apps/web/src/features/plugin/iframe/iframe-pool.ts`), so it is NOT
 * controlled by this service worker; its requests are never seen here.
 */

/**
 * The resource-content API prefix. Must stay in sync with the token-path
 * families re-used in `apps/server/src/infra/http/plugin.ts` (the auth
 * preHandler) and `plugins/workbench/scripts/mounts.mjs`, and with the
 * `apiPaths.resources.*` builders in `./paths.ts`.
 */
const RESOURCE_API_BASE = "/api/resources/"

/**
 * Whether a GET request should be served from the resource-content
 * `CacheFirst` cache (files / video seek frames / extracted content).
 */
export function isResourceContentRequest(input: {
	readonly method: string
	readonly pathname: string
	/** True when the request carries a Range header (byte-range streaming). */
	readonly hasRange: boolean
	/** True when the request's origin is the app origin (`self.location.origin`). */
	readonly sameOrigin: boolean
}): boolean {
	return (
		input.method === "GET" &&
		!input.hasRange &&
		input.sameOrigin &&
		input.pathname.startsWith(RESOURCE_API_BASE) &&
		(input.pathname.includes("/files/") ||
			input.pathname.includes("/frame/") ||
			input.pathname.includes("/extracted/"))
	)
}

/**
 * Collapse the per-resource token out of a content path so a rotated token
 * still maps to the same cache entry. Strips the token segment from
 * `/files/<token>/…`, `/frame/<token>/…` and `/extracted/<token>/…` (keeping
 * the family keyword) and folds the trailing `/files/<token>/` base back to
 * `/files/`.
 */
export function normalizeResourceCacheKey(pathname: string): string {
	return pathname
		.replace(/\/(files|frame|extracted)\/([A-Za-z0-9_.-]+)\/(.+)/, "/$1/$3")
		.replace(/\/files\/[^/]+\/$/, "/files/")
}
