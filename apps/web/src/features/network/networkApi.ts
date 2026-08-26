import type { UseMutationOptions } from "@tanstack/react-query"
import type { RouterOutputs } from "@/trpc/client"
import { trpcQuery, trpcQueryOptions } from "@/trpc/factory"

export const networkKeys = {
	all: ["network"] as const,
	info: () => [...networkKeys.all, "info"] as const,
}

type NetworkInfo = RouterOutputs["network"]["info"]
type NetworkTest = RouterOutputs["network"]["test"]

export function networkInfoQueryOptions() {
	return trpcQueryOptions({
		namespace: "network",
		procedure: "info",
		input: undefined,
		queryKey: networkKeys.info(),
		staleTime: 60_000,
	})
}

/** User-triggered GitHub connectivity probe; the result is not cached. */
export function networkTestMutation(): UseMutationOptions<
	NetworkTest,
	Error,
	void
> {
	return {
		mutationFn: () => trpcQuery("network", "test", undefined),
	}
}

export type { NetworkInfo }
