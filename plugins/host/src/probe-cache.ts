/**
 * Process-wide LRU cache for host-side probe results (image/video/audio
 * metadata and animation flags). Source archives are immutable per
 * fileVersion, so entries never need explicit invalidation — the cache
 * scope carries the version and the LRU bound handles eviction.
 */

/** Process-wide bound (entries) for the host-side probe result cache. */
export const PLUGIN_PROBE_CACHE_MAX_ENTRIES = 512

/** Cacheable probe result; `undefined` marks a probe that found nothing. */
type ProbeValue = object | boolean | undefined

export type PluginProbeCache = {
	/**
	 * Return the cached result for `key`, computing and storing it on a
	 * miss. Concurrent callers for the same key share one computation.
	 */
	readonly getOrCompute: <T extends ProbeValue>(
		key: string,
		compute: () => Promise<T>,
	) => Promise<T>
}

/**
 * Create the probe LRU cache. Keys are caller-composed (probe kind +
 * version + path); concurrent misses single-flight through one shared
 * computation; failures are evicted so the next caller retries.
 */
export function createProbeCache(
	maxEntries = PLUGIN_PROBE_CACHE_MAX_ENTRIES,
): PluginProbeCache {
	// Promise-valued cells: a miss is stored before it settles, so
	// concurrent probes for the same key single-flight through one
	// computation.
	const cells = new Map<string, Promise<ProbeValue>>()

	return {
		getOrCompute<T extends ProbeValue>(
			key: string,
			compute: () => Promise<T>,
		): Promise<T> {
			const existing = cells.get(key)
			if (existing !== undefined) {
				// Refresh LRU position.
				cells.delete(key)
				cells.set(key, existing)
				// Type-erased store: each key is namespaced by probe kind, so
				// the stored promise always resolves to the caller's T.
				return existing as Promise<T>
			}
			const promise = compute()
			cells.set(key, promise)
			promise.catch(() => {
				// Failures are not cached — the next caller retries.
				if (cells.get(key) === promise) cells.delete(key)
			})
			if (cells.size > maxEntries) {
				const oldest = cells.keys().next().value
				if (oldest !== undefined) cells.delete(oldest)
			}
			return promise
		},
	}
}
