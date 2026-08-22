import { queryOptions } from "@tanstack/react-query"
import { makeInvalidator } from "@/lib/makeInvalidator"
import { idMutation, trpcMutation, trpcQuery } from "@/trpc/factory"

export const syncKeys = {
	all: ["sync"] as const,
	summary: () => [...syncKeys.all, "summary"] as const,
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
