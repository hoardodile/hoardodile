/**
 * Process-wide cache of nested container listings (central directories
 * of zip/tar entries addressed via virtual paths). Resolving
 * `outer!inner` re-parses the outer archive's CD on every hook call;
 * this cache keeps the parsed listing resident so a multi-hook pass
 * (sourceMeta → cover → hashes → listFiles) parses each nested archive
 * once.
 *
 * Keyed by the outer entry name only — callers scope the cache instance
 * to a fixed (resId, fileVersion), and archives are immutable per
 * version, so a key never outlives its content.
 */
export type NestedCdCache = {
	readonly get: (key: string) => Promise<unknown> | undefined
	readonly set: (key: string, value: Promise<unknown>) => void
	readonly clear: () => void
}

export type NestedCdCacheOptions = {
	/** Max number of nested archives kept resident. */
	readonly maxEntries: number
}

const DEFAULT_MAX_ENTRIES = 512

/** Create an LRU-bounded nested listing cache. */
export function createNestedCdCache(
	opts?: Partial<NestedCdCacheOptions>,
): NestedCdCache {
	const maxEntries = opts?.maxEntries ?? DEFAULT_MAX_ENTRIES
	const lru = new Map<string, Promise<unknown>>()

	function get(key: string): Promise<unknown> | undefined {
		const value = lru.get(key)
		if (value === undefined) return undefined
		lru.delete(key)
		lru.set(key, value)
		return value
	}

	function set(key: string, value: Promise<unknown>): void {
		lru.set(key, value)
		while (lru.size > maxEntries) {
			const oldest = lru.keys().next().value
			if (oldest === undefined) break
			lru.delete(oldest)
		}
	}

	function clear(): void {
		lru.clear()
	}

	return { get, set, clear }
}
