import { type QueryClient, queryOptions, useQuery } from "@tanstack/react-query"
import { makeInvalidator } from "@/lib/makeInvalidator"
import { idMutation, trpcMutation, trpcQuery } from "@/trpc/factory"

export const catKeys = {
	all: ["category"] as const,
	listWithCounts: ["category", "withCounts"] as const,
}

const baseInvalidateCategories = makeInvalidator({ all: catKeys.all })

export function catListQueryOptions() {
	return queryOptions({
		queryKey: catKeys.all,
		queryFn: () => trpcQuery("category", "listAll", undefined),
		staleTime: 2_000,
	})
}

export function catListWithCountsQueryOptions() {
	return queryOptions({
		queryKey: catKeys.listWithCounts,
		queryFn: () => trpcQuery("category", "listAllWithCounts", undefined),
		staleTime: 2_000,
	})
}

export async function invalidateCategories(qc: QueryClient): Promise<void> {
	await baseInvalidateCategories(qc)
}

export function createCategoryMutation() {
	return trpcMutation("category", "create")
}

export function updateCategoryMutation() {
	return trpcMutation("category", "update")
}

export function reorderCategoryMutation() {
	return trpcMutation("category", "reorder")
}

export function deleteCategoryMutation() {
	return idMutation("category", "delete")
}

export function forceDeleteCategoryMutation() {
	return trpcMutation("category", "forceDelete")
}

export function useCategoryList(): readonly import("@hoardodile/schemas").Category[] {
	const q = useQuery(catListQueryOptions())
	return q.data ?? []
}

export function useCategoryStoreStatus():
	| "idle"
	| "loading"
	| "ready"
	| "error" {
	const q = useQuery(catListQueryOptions())
	if (q.isLoading) return "loading"
	if (q.isError) return "error"
	if (q.data !== undefined) return "ready"
	return "idle"
}
