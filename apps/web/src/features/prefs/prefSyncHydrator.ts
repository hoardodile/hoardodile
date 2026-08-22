/**
 * Hydration manager for sync-scoped system prefs.
 *
 * Fetches all server-stored sync preferences and bulk-loads them into the
 * in-memory store so components can read them synchronously on mount.
 *
 * Async-scoped preferences are intentionally excluded by the server; they
 * are fetched on demand via the `asyncPreference` tRPC namespace.
 */

import { notifyPrefSync } from "@/lib/prefSync"
import { prefSyncStore } from "@/lib/prefSyncStore"
import { trpcQuery } from "@/trpc/factory"

type HydrationState = "idle" | "loading" | "loaded" | "error"

let hydrationState: HydrationState = "idle"

/**
 * Fetch all system preferences from the server and bulk-load them into
 * the in-memory store.
 *
 * Idempotent: subsequent calls return a resolved promise if already loaded.
 */
export function hydrateSystemPrefs(): Promise<void> {
	if (hydrationState === "loading" || hydrationState === "loaded") {
		return Promise.resolve()
	}

	hydrationState = "loading"

	return trpcQuery("systemPreference", "listAll")
		.then(function applyServerPrefs(entries) {
			const changedKeys: string[] = []
			for (const entry of entries) {
				if (entry.value === undefined || entry.value === "") continue
				const local = prefSyncStore.get(entry.key)
				if (local !== entry.value) {
					prefSyncStore.setSilent(entry.key, entry.value)
					changedKeys.push(entry.key)
				}
			}
			// Write to localStorage so stale source is up to date.
			for (const key of changedKeys) {
				const value = prefSyncStore.get(key)
				if (value !== undefined) {
					try {
						localStorage.setItem(key, value)
					} catch {}
				}
			}
			// Notify after bulk-load so each subscriber fires once.
			for (const key of changedKeys) {
				notifyPrefSync(key)
			}
			hydrationState = "loaded"
		})
		.catch(function onHydrateError() {
			hydrationState = "error"
		})
}

/** Check whether system prefs have already been successfully hydrated. */
export function isSystemPrefsHydrated(): boolean {
	return hydrationState === "loaded"
}

/** Reset hydration state so the next call re-fetches. */
export function invalidateSystemPrefsHydration(): void {
	hydrationState = "idle"
}
