import { trpcQueryOptions } from "@/trpc/factory"

export const storageKeys = {
	all: ["storage"] as const,
	overview: () => [...storageKeys.all, "overview"] as const,
}

export function storageOverviewQueryOptions() {
	return trpcQueryOptions({
		namespace: "storage",
		procedure: "overview",
		input: undefined,
		queryKey: storageKeys.overview(),
		// The server memoizes the expensive directory scan for 60s; keep the
		// client cache aligned so re-renders never refetch mid-window.
		staleTime: 60_000,
	})
}

export type { StorageOverview } from "@hoardodile/schemas"
