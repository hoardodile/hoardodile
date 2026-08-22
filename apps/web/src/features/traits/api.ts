import type { TraitDef } from "@hoardodile/schemas"
import { queryOptions } from "@tanstack/react-query"
import { makeInvalidator } from "@/lib/makeInvalidator"
import { idMutation, trpcMutation, trpcQuery } from "@/trpc/factory"

export const traitKeys = {
	all: ["trait"] as const,
	list: () => [...traitKeys.all, "list"] as const,
	listWithCounts: () => [...traitKeys.all, "list-with-counts"] as const,
	detail: (id: string) => [...traitKeys.all, "detail", id] as const,
}

export type TraitDefWithCounts = TraitDef & {
	readonly charCount: number
}

export function traitListQueryOptions() {
	return queryOptions({
		queryKey: traitKeys.list(),
		queryFn: () => trpcQuery("trait", "listAll", undefined),
		staleTime: 30_000,
	})
}

export function traitListWithCountsQueryOptions() {
	return queryOptions({
		queryKey: traitKeys.listWithCounts(),
		queryFn: () => trpcQuery("trait", "listAllWithCounts", undefined),
		staleTime: 30_000,
	})
}

export const invalidateTraits = makeInvalidator({ all: traitKeys.all })

export function createTraitMutation() {
	return trpcMutation("trait", "create")
}

export function updateTraitMutation() {
	return trpcMutation("trait", "update")
}

export function deleteTraitMutation() {
	return idMutation("trait", "delete")
}

export function forceDeleteTraitMutation() {
	return trpcMutation("trait", "forceDelete")
}

export function reorderTraitMutation() {
	return trpcMutation("trait", "reorder")
}
