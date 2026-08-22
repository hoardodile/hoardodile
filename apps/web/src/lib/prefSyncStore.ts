/**
 * In-memory key/value store — the synchronous backing for {@link prefSync}.
 *
 * Replaces localStorage as the primary storage layer. Values are held in
 * a `Map<string, string>` and subscriber notifications fire on mutation.
 *
 * This store is used by the web app for system prefs only. Plugin iframes
 * maintain their own local stores seeded from PluginIframeContext.
 */

type Subscriber = () => void

const store = new Map<string, string>()
const subscribers = new Map<string, Set<Subscriber>>()

function notify(key: string): void {
	const set = subscribers.get(key)
	if (set === undefined) return
	for (const cb of set) {
		cb()
	}
}

export const prefSyncStore = {
	get(key: string): string | undefined {
		return store.get(key)
	},

	set(key: string, value: string): void {
		store.set(key, value)
		notify(key)
	},

	/** Bulk-load without firing subscribers (used by hydration). */
	setSilent(key: string, value: string): void {
		store.set(key, value)
	},

	delete(key: string): void {
		store.delete(key)
		notify(key)
	},

	has(key: string): boolean {
		return store.has(key)
	},

	subscribe(key: string, callback: Subscriber): () => void {
		let set = subscribers.get(key)
		if (set === undefined) {
			set = new Set()
			subscribers.set(key, set)
		}
		set.add(callback)
		return function unsubscribe() {
			set!.delete(callback)
			if (set!.size === 0) {
				subscribers.delete(key)
			}
		}
	},

	keys(): IterableIterator<string> {
		return store.keys()
	},

	/** Test-only: wipe the in-memory store and all subscriptions. */
	clear(): void {
		store.clear()
		subscribers.clear()
	},

	/** Notify subscribers for a key without mutating the store. */
	trigger(key: string): void {
		notify(key)
	},
} as const
