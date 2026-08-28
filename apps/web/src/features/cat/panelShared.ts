import type { Category } from "@hoardodile/schemas"
import { type QueryClient, useQuery } from "@tanstack/react-query"
import {
	catListWithCountsQueryOptions,
	invalidateCategories,
} from "@/features/cat"
import { invalidateTags } from "@/features/tags"

/** Invalidate everything the combined categories + tags panel displays. */
export async function invalidateCategoriesAndTags(
	qc: QueryClient,
): Promise<void> {
	await invalidateCategories(qc)
	await invalidateTags(qc)
}

/** Category options for selects, from the shared with-counts query. */
export function useCategoryOptions(): readonly Category[] {
	const q = useQuery(catListWithCountsQueryOptions())
	return q.data ?? []
}
