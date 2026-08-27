import { queryOptions } from "@tanstack/react-query"
import { makeInvalidator } from "@/lib/makeInvalidator"
import { idMutation, trpcMutation, trpcQuery } from "@/trpc/factory"

export const syncKeys = {
	all: ["sync"] as const,
	summary: () => [...syncKeys.all, "summary"] as const,
	current: () => [...syncKeys.all, "current"] as const,
}

export function syncSummaryQueryOptions() {
	return queryOptions({
		queryKey: syncKeys.summary(),
		queryFn: () => trpcQuery("sync", "summary"),
		staleTime: 30_000,
		// An open tab must flip to the reminder state without navigation.
		refetchInterval: 60_000,
	})
}

/**
 * Live library state (counts + storage) used by the sync page's change
 * view. Kept separate from the cheap {@link syncSummaryQueryOptions} —
 * only this page pays for the count queries and the cached storage scan.
 */
export function syncCurrentQueryOptions() {
	return queryOptions({
		queryKey: syncKeys.current(),
		queryFn: () => trpcQuery("sync", "current"),
		staleTime: 30_000,
		// The change view must stay live while the page is open.
		refetchInterval: 60_000,
	})
}

export const invalidateSync = makeInvalidator({ all: syncKeys.all })

export function createSyncDeviceMutation() {
	return trpcMutation("sync", "deviceCreate")
}

export function updateSyncDeviceMutation() {
	return trpcMutation("sync", "deviceUpdate")
}

export function deleteSyncDeviceMutation() {
	return idMutation("sync", "deviceDelete")
}

export function recordSyncMutation() {
	return trpcMutation("sync", "recordCreate")
}
