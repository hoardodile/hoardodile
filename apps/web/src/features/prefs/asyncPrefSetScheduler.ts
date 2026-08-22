import type { QueryClient } from "@tanstack/react-query"
import { debounce } from "es-toolkit"
import { trpcMutate } from "@/trpc/factory"
import { asyncPrefQueryKey } from "./asyncPrefQuery"

const PREF_SET_DEBOUNCE_MS = 500

type Flush = (() => void) & { readonly flush: () => void }

type PendingEntry = {
	readonly run: Flush
	latest: string
}

const pending = new Map<string, PendingEntry>()

function flushKey(key: string): void {
	const current = pending.get(key)
	if (current === undefined) return
	pending.delete(key)
	trpcMutate("asyncPreference", "set", { key, value: current.latest }).catch(
		swallow,
	)
}

function swallow(): void {
	// Fire-and-forget: pref writes are best-effort.
}

/**
 * Update the React Query cache immediately and schedule a debounced server
 * write for the given async pref key.
 *
 * Rapid updates to the same key collapse into a single `asyncPreference.set`
 * request after the debounce window settles.
 */
export function scheduleAsyncPrefSet(
	key: string,
	value: string,
	queryClient: QueryClient,
): void {
	queryClient.setQueryData(asyncPrefQueryKey(key), value)

	let entry = pending.get(key)
	if (entry === undefined) {
		const run = debounce(() => flushKey(key), PREF_SET_DEBOUNCE_MS) as Flush
		entry = { run, latest: value }
		pending.set(key, entry)
	} else {
		entry.latest = value
	}
	entry.run()
}

function flushAllPending(): void {
	const entries = [...pending.entries()]
	pending.clear()
	for (const [key, entry] of entries) {
		trpcMutate("asyncPreference", "set", { key, value: entry.latest }).catch(
			swallow,
		)
	}
}

if (typeof window !== "undefined") {
	window.addEventListener("pagehide", flushAllPending)
	window.addEventListener("beforeunload", flushAllPending)
}
