/**
 * Synchronous preference API backed by an in-memory store.
 *
 * - `get` reads from the in-memory store immediately (no async wait).
 * - `set` writes to the in-memory store immediately and notifies subscribers.
 * - `subscribe` registers a callback that fires when the value changes
 *   (same-tab writes or server overwrites).
 *
 * Server sync is handled by a separate sidecar ({@link prefSyncQueue})
 * that hooks into `set` calls and debounces tRPC writes.
 *
 * Cross-tab synchronization is currently disabled: see
 * {@link CROSS_TAB_PREF_SYNC}.
 */

import { channelNames, signalPrefixes } from "./keys"
import { prefSyncStore } from "./prefSyncStore"

const CROSS_TAB_PREF_SYNC = false

type Subscriber = () => void

type SetHook = (key: string, value: string) => void

let setHook: SetHook | undefined

type BroadcastMessage =
	| { readonly type: "set"; readonly key: string; readonly value: string }
	| { readonly type: "delete"; readonly key: string }

let channel: BroadcastChannel | undefined

function getChannel(): BroadcastChannel | undefined {
	if (channel !== undefined) return channel
	if (typeof BroadcastChannel === "undefined") return undefined
	channel = new BroadcastChannel(channelNames.prefSync)
	channel.addEventListener(
		"message",
		function onMessage(event: MessageEvent<BroadcastMessage>) {
			const msg = event.data
			if (msg?.type === "set") {
				prefSyncStore.setSilent(msg.key, msg.value)
				notifyPrefSync(msg.key)
			} else if (msg?.type === "delete") {
				prefSyncStore.delete(msg.key)
			}
		},
	)
	return channel
}

function makeSignalKey(key: string): string {
	return `${signalPrefixes.prefSync}${key}`
}

export function broadcastPrefSyncSet(key: string, value: string): void {
	if (!CROSS_TAB_PREF_SYNC) return
	const ch = getChannel()
	if (ch !== undefined) {
		ch.postMessage({ type: "set", key, value } satisfies BroadcastMessage)
		return
	}
	// Fallback: localStorage signaling
	try {
		const signalKey = makeSignalKey(key)
		window.localStorage.setItem(signalKey, String(Date.now()))
		window.localStorage.removeItem(signalKey)
	} catch {
		// Ignore quota errors
	}
}

export function broadcastPrefSyncDelete(key: string): void {
	if (!CROSS_TAB_PREF_SYNC) return
	const ch = getChannel()
	if (ch !== undefined) {
		ch.postMessage({ type: "delete", key } satisfies BroadcastMessage)
		return
	}
	// Fallback
	try {
		const signalKey = makeSignalKey(key)
		window.localStorage.setItem(signalKey, String(Date.now()))
		window.localStorage.removeItem(signalKey)
	} catch {
		// Ignore
	}
}

if (CROSS_TAB_PREF_SYNC && typeof window !== "undefined") {
	window.addEventListener(
		"storage",
		function handleStorage(event: StorageEvent) {
			if (event.storageArea !== window.localStorage) return
			if (event.key === null) return

			// System pref: sync real data into prefSyncStore.
			if (!event.key.startsWith(signalPrefixes.prefSync)) {
				if (event.newValue !== null) {
					prefSyncStore.setSilent(event.key, event.newValue)
					notifyPrefSync(event.key)
				} else {
					prefSyncStore.delete(event.key)
				}
				return
			}

			// Plugin pref signal (fallback when BroadcastChannel unavailable).
			if (typeof BroadcastChannel === "undefined") {
				const realKey = event.key.slice(5)
				notifyPrefSync(realKey)
			}
		},
	)
}

export const prefSync = {
	get(key: string): string | undefined {
		const mem = prefSyncStore.get(key)
		if (mem !== undefined) return mem
		try {
			return localStorage.getItem(key) ?? undefined
		} catch {
			return undefined
		}
	},

	set(key: string, value: string): void {
		prefSyncStore.set(key, value)
		try {
			localStorage.setItem(key, value)
		} catch {
			// best-effort
		}
		setHook?.(key, value)
		broadcastPrefSyncSet(key, value)
	},

	subscribe(key: string, callback: Subscriber): () => void {
		return prefSyncStore.subscribe(key, callback)
	},
} as const

/** Allow external modules (e.g. server sync queue) to hook into set calls. */
export function registerPrefSyncSetHook(hook: SetHook): () => void {
	setHook = hook
	return function unregister() {
		setHook = undefined
	}
}

/** Allow external modules to trigger subscriber notifications (e.g. after server overwrite). */
export function notifyPrefSync(key: string): void {
	prefSyncStore.trigger(key)
}
