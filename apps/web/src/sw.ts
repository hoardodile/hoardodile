// @ts-nocheck
import { ExpirationPlugin } from "workbox-expiration"
import { cleanupOutdatedCaches, precacheAndRoute } from "workbox-precaching"
import { registerRoute } from "workbox-routing"
import { CacheFirst } from "workbox-strategies"
import {
	isResourceContentRequest,
	normalizeResourceCacheKey,
} from "./lib/sw-cache"

const RES_CACHE_NAME = "hoardodile-res-v1"

self.addEventListener("install", (event) => {
	// Activate the new worker as soon as install completes. Workbox's
	// precacheAndRoute() already extends the install event until the
	// precache is fully written, so the worker cannot activate before
	// the precache is ready.
	event.waitUntil(self.skipWaiting())
})

// Register its own activate listener so the handler is added during
// the worker's initial evaluation, avoiding the browser warning.
cleanupOutdatedCaches()

self.addEventListener("activate", (event) => {
	// Only claim clients here. Do NOT delete all caches: Workbox stores
	// the precache in its own cache (workbox-precache-v2-...), and
	// wiping it on activation causes "precached response ... was not found"
	// on every fetch. Outdated Workbox precaches are handled by
	// cleanupOutdatedCaches() above.
	event.waitUntil(self.clients.claim())
})

// Static assets (JS, CSS, HTML) — injected by vite-plugin-pwa at build time
precacheAndRoute(self.__WB_MANIFEST)

/** Prevent caching failed responses — a cached 401 would poison the cache forever. */
const cacheOnlySuccess = {
	cacheWillUpdate: async ({ response }: { response: Response }) => {
		if (response.ok) return response
		return null
	},
}

const normalizeCacheKey = {
	cacheKeyWillBeUsed: async ({ request }) => {
		const url = new URL(request.url)
		url.pathname = normalizeResourceCacheKey(url.pathname)
		return url.toString()
	},
}

// API resource content files and video frames
registerRoute(
	({ request, url }) =>
		isResourceContentRequest({
			method: request.method,
			pathname: url.pathname,
			hasRange: request.headers.has("range"),
			sameOrigin: url.origin === self.location.origin,
		}),
	new CacheFirst({
		cacheName: RES_CACHE_NAME,
		plugins: [
			cacheOnlySuccess,
			normalizeCacheKey,
			new ExpirationPlugin({
				maxEntries: 5000,
			}),
		],
	}),
)
