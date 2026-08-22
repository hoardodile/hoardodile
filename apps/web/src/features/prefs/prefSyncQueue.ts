/**
 * Server sync sidecar for {@link prefSync}.
 *
 * - Hooks into `prefSync.set` calls and debounces tRPC `systemPreference.set`
 *   writes ({@link PREF_SYNC_DEBOUNCE_MS} per key) via es-toolkit's
 *   `debounce`, which gives us `.flush()` / `.cancel()` semantics.
 * - Flushes all pending writes on `pagehide` / `beforeunload`.
 * - On init, hydrates system prefs explicitly via `listAll`.
 */

import { debounce } from "es-toolkit"
import { registerPrefSyncSetHook } from "@/lib/prefSync"
import { trpcMutate } from "@/trpc/factory"
import { hydrateSystemPrefs } from "./prefSyncHydrator"

const PREF_SYNC_DEBOUNCE_MS = 500

type PendingFlush = ReturnType<typeof debounce>

type PendingEntry = {
	readonly run: PendingFlush
	latest: string
}

const pending = new Map<string, PendingEntry>()

function scheduleServerWrite(key: string, value: string): void {
	let entry = pending.get(key)
	if (entry === undefined) {
		const run = debounce(function flushKey() {
			const current = pending.get(key)
			if (current === undefined) return
			trpcMutate("systemPreference", "set", {
				key,
				value: current.latest,
			}).catch(swallow)
		}, PREF_SYNC_DEBOUNCE_MS)
		entry = { run, latest: value }
		pending.set(key, entry)
	} else {
		entry.latest = value
	}
	entry.run()
}

function flushAllPending(): void {
	for (const entry of pending.values()) {
		entry.run.flush()
	}
}

/** Initialise the sync queue: register set hook and start hydration. */
export function initPrefSyncQueue(): void {
	registerPrefSyncSetHook(scheduleServerWrite)

	// Hydrate system prefs immediately.
	hydrateSystemPrefs()

	window.addEventListener("pagehide", flushAllPending)
	window.addEventListener("beforeunload", flushAllPending)
}

function swallow(): void {
	// Fire-and-forget: cache invalidation and server sync are best-effort.
}
