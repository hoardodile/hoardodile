import { type QueryClient, queryOptions } from "@tanstack/react-query"
import { makeInvalidator } from "@/lib/makeInvalidator"
import { idMutation, trpcMutation, trpcQuery } from "@/trpc/factory"

export const colKeys = {
	all: ["resCollection"] as const,
	listWithCounts: ["resCollection", "withCounts"] as const,
	forResource: (resId: string) =>
		[...colKeys.all, "forResource", resId] as const,
	resourcesIn: (colId: string) =>
		[...colKeys.all, "resourcesIn", colId] as const,
}

const baseInvalidateCollections = makeInvalidator({ all: colKeys.all })

export function colListQueryOptions() {
	return queryOptions({
		queryKey: colKeys.all,
		queryFn: () => trpcQuery("resCollection", "listAll", undefined),
		staleTime: 2_000,
	})
}

export function colListWithCountsQueryOptions() {
	return queryOptions({
		queryKey: colKeys.listWithCounts,
		queryFn: () => trpcQuery("resCollection", "listAllWithCounts", undefined),
		staleTime: 2_000,
	})
}

export function colsForResourceQueryOptions(resId: string) {
	return queryOptions({
		queryKey: colKeys.forResource(resId),
		queryFn: () => trpcQuery("resCollection", "listForResource", { resId }),
		staleTime: 2_000,
	})
}

export function colResourceIdsQueryOptions(colId: string) {
	return queryOptions({
		queryKey: colKeys.resourcesIn(colId),
		queryFn: () => trpcQuery("resCollection", "listResourceIdsIn", { colId }),
		staleTime: 2_000,
	})
}

export async function invalidateCollections(qc: QueryClient): Promise<void> {
	await baseInvalidateCollections(qc)
	await qc.invalidateQueries({ queryKey: ["resource"] })
}

export function createCollectionMutation() {
	return trpcMutation("resCollection", "create")
}

export function updateCollectionMutation() {
	return trpcMutation("resCollection", "update")
}

export function deleteCollectionMutation() {
	return idMutation("resCollection", "delete")
}

export function forceDeleteCollectionMutation() {
	return trpcMutation("resCollection", "forceDelete")
}

export function attachResourceToCollectionMutation() {
	return trpcMutation("resCollection", "attach")
}

export function detachResourceFromCollectionMutation() {
	return trpcMutation("resCollection", "detach")
}

export function reorderCollectionsMutation() {
	return trpcMutation("resCollection", "reorder")
}
