import { useQuery } from "@tanstack/react-query"
import { tagListQueryOptions } from "./api"

/**
 * Subscribe to the global tag list via TanStack Query.
 * The list is fetched on first mount and invalidated by mutations.
 */
export function useTagList(): readonly import("@hoardodile/schemas").Tag[] {
	const q = useQuery(tagListQueryOptions())
	return q.data ?? []
}

/** Loading state for the tag list. */
export function useTagStoreStatus(): "idle" | "loading" | "ready" | "error" {
	const q = useQuery(tagListQueryOptions())
	if (q.isLoading) return "loading"
	if (q.isError) return "error"
	if (q.data !== undefined) return "ready"
	return "idle"
}
