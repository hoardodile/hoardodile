import { queryOptions } from "@tanstack/react-query"
import { trpcQuery } from "@/trpc/factory"

export function asyncPrefQueryKey(
	key: string,
): readonly ["asyncPreference", "get", string] {
	return ["asyncPreference", "get", key] as const
}

/**
 * React Query options for a single async preference.
 *
 * Async prefs are fetched on demand via the `asyncPreference` tRPC namespace
 * and are intentionally excluded from the synchronous prefSync hydration
 * pipeline.
 *
 * Returns `null` when the key is absent so React Query can cache a stable
 * "missing" state (it rejects `undefined` data).
 *
 * `staleTime: 5_000` keeps the data fresh long enough that StrictMode
 * double-mounts and rapid route transitions do not issue duplicate requests.
 */
export function asyncPrefQueryOptions(key: string) {
	return queryOptions({
		queryKey: asyncPrefQueryKey(key),
		queryFn: async () => {
			const entry = await trpcQuery("asyncPreference", "get", { key })
			return entry?.value ?? null
		},
		staleTime: 5_000,
	})
}
