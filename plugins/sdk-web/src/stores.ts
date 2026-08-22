import type { PluginIframeContext } from "./protocol.ts"

/**
 * In-memory module-level stores backing the plugin's pref/cache APIs
 * (`api.getPref`/`setPref`, `api.getCache`/`setCache`). Seeded from the
 * iframe context on mount; prefs mirror the host's plugin-wide settings,
 * cache is per-resource state that the host persists (debounced) and
 * restores on the next visit.
 */
const pluginPrefStore = new Map<string, string>()
const pluginCacheStore = new Map<string, string>()

/**
 * Reset both stores and seed them from the iframe context. Called once
 * by the runtime on mount; must run before any pref/cache access.
 */
export function seedPluginStores(ctx: PluginIframeContext): void {
	pluginPrefStore.clear()
	for (const [k, v] of Object.entries(ctx.initialPrefs)) {
		pluginPrefStore.set(k, v)
	}
	pluginCacheStore.clear()
	for (const [k, v] of Object.entries(ctx.initialCache)) {
		pluginCacheStore.set(k, v)
	}
}

/** Read-only view of the plugin's in-memory pref store. */
export function getPluginPrefStore(): ReadonlyMap<string, string> {
	return pluginPrefStore
}

/** Write a pref locally; mirror it to the host immediately. */
export function setPluginPref(key: string, value: string): void {
	pluginPrefStore.set(key, value)
}

/** Read-only view of the plugin's in-memory cache store. */
export function getPluginCacheStore(): ReadonlyMap<string, string> {
	return pluginCacheStore
}

/**
 * Write a cache entry locally and mirror it to the host for persistence.
 * Continuously-changing state (scroll positions, resume timestamps)
 * should go through the debounced `useCacheWriter` in
 * `@hoardodile/sdk-react` instead of calling this directly on every
 * change.
 */
export function setPluginCache(key: string, value: string): void {
	pluginCacheStore.set(key, value)
}

/**
 * Snapshot of all cache entries, as returned by `api.listCache`. Values
 * are the raw serialized strings stored via {@link setPluginCache}.
 */
export function snapshotCacheEntries(): {
	readonly key: string
	readonly value: string
}[] {
	const result: { readonly key: string; readonly value: string }[] = []
	for (const [key, value] of pluginCacheStore) {
		result.push({ key, value })
	}
	return result
}

// ── Pref change pub/sub ──────────────────────────────────────────────────

const prefChangeListeners = new Map<string, Set<() => void>>()

/**
 * Subscribe to pref changes for `key` (both local writes and host-pushed
 * updates). Returns an unsubscribe function. Backs the reactive
 * `usePref` hook in `@hoardodile/sdk-react`.
 */
export function subscribeToPrefChanges(
	key: string,
	cb: () => void,
): () => void {
	let listeners = prefChangeListeners.get(key)
	if (listeners === undefined) {
		listeners = new Set()
		prefChangeListeners.set(key, listeners)
	}
	listeners.add(cb)
	return function unsubscribe() {
		listeners!.delete(cb)
		if (listeners!.size === 0) {
			prefChangeListeners.delete(key)
		}
	}
}

/** Notify all subscribers of `key` about a value change. */
export function broadcastPrefChange(key: string): void {
	const listeners = prefChangeListeners.get(key)
	if (listeners === undefined) return
	for (const cb of listeners) {
		cb()
	}
}
