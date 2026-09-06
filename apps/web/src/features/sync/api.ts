import { queryOptions } from "@tanstack/react-query"
import { trpcQuery } from "@/trpc/factory"

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
