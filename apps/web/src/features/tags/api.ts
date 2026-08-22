import { type QueryClient, queryOptions } from "@tanstack/react-query"
import { makeInvalidator } from "@/lib/makeInvalidator"
import { idMutation, trpcMutation, trpcQuery } from "@/trpc/factory"

export const tagKeys = {
	all: ["tag"] as const,
	listWithCounts: ["tag", "withCounts"] as const,
	forResource: (resId: string) =>
		[...tagKeys.all, "forResource", resId] as const,
	forCharacter: (charId: string) =>
		[...tagKeys.all, "forCharacter", charId] as const,
} as const

const baseInvalidateTags = makeInvalidator({ all: tagKeys.all })

export function tagListQueryOptions() {
	return queryOptions({
		queryKey: tagKeys.all,
		queryFn: () => trpcQuery("tag", "listAll", undefined),
		staleTime: 2_000,
	})
}

export function tagListWithCountsQueryOptions() {
	return queryOptions({
		queryKey: tagKeys.listWithCounts,
		queryFn: () => trpcQuery("tag", "listAllWithCounts", undefined),
		staleTime: 2_000,
	})
}

export function tagsForResourceQueryOptions(resId: string) {
	return queryOptions({
		queryKey: tagKeys.forResource(resId),
		queryFn: () => trpcQuery("tag", "listForResource", { resId }),
		staleTime: 2_000,
	})
}

export function tagsForCharacterQueryOptions(charId: string) {
	return queryOptions({
		queryKey: tagKeys.forCharacter(charId),
		queryFn: () => trpcQuery("tag", "listForCharacter", { charId }),
		staleTime: 2_000,
	})
}

export async function invalidateTags(qc: QueryClient): Promise<void> {
	await baseInvalidateTags(qc)
}

export function createTagMutation() {
	return trpcMutation("tag", "create")
}

export function updateTagMutation() {
	return trpcMutation("tag", "update")
}

export function reorderTagMutation() {
	return trpcMutation("tag", "reorder")
}

export function deleteTagMutation() {
	return idMutation("tag", "delete")
}

export function forceDeleteTagMutation() {
	return trpcMutation("tag", "forceDelete")
}

const mergePreviewKey = (
	sourceId: string | undefined,
	targetId: string | undefined,
) => ["tag", "mergePreview", sourceId, targetId] as const

export function tagMergePreviewQueryOptions(
	sourceId: string | undefined,
	targetId: string | undefined,
) {
	return queryOptions({
		queryKey: mergePreviewKey(sourceId, targetId),
		queryFn: () =>
			trpcQuery("tag", "mergePreview", {
				sourceId: sourceId ?? "",
				targetId: targetId ?? "",
			}),
		enabled: sourceId !== undefined && targetId !== undefined,
		staleTime: 2_000,
	})
}

export function mergeTagsMutation() {
	return trpcMutation("tag", "merge")
}

export type TagSiblingGroup = {
	readonly displayTagId: string
	readonly memberTagIds: readonly string[]
	/** Character entities linked into this group (avatar chip members). */
	readonly memberCharacters: readonly {
		readonly id: string
		readonly name: string
		readonly updatedAt: number
	}[]
	readonly resCount: number
	readonly charCount: number
}

export type TagParentRule = {
	readonly childKind: "tag" | "character"
	readonly childId: string
	readonly parentId: string
}

export function siblingGroupsQueryOptions() {
	return queryOptions({
		queryKey: ["tag", "siblingGroups"] as const,
		queryFn: () => trpcQuery("tag", "siblingGroups", undefined),
		staleTime: 2_000,
	})
}

export function siblingRuleCreateMutation() {
	return trpcMutation("tag", "siblingRuleCreate")
}

export function siblingRuleRemoveMutation() {
	return trpcMutation("tag", "siblingRuleRemove")
}

export function siblingSetDisplayMutation() {
	return trpcMutation("tag", "siblingSetDisplay")
}

export function parentRulesQueryOptions() {
	return queryOptions({
		queryKey: ["tag", "parentRules"] as const,
		queryFn: () => trpcQuery("tag", "parentRules", undefined),
		staleTime: 2_000,
	})
}

export function parentRuleCreateMutation() {
	return trpcMutation("tag", "parentRuleCreate")
}

export function parentRuleRemoveMutation() {
	return trpcMutation("tag", "parentRuleRemove")
}

export function attachToResourceMutation() {
	return trpcMutation("tag", "attachToResource")
}

export function detachFromResourceMutation() {
	return trpcMutation("tag", "detachFromResource")
}

export function attachToCharacterMutation() {
	return trpcMutation("tag", "attachToCharacter")
}

export function detachFromCharacterMutation() {
	return trpcMutation("tag", "detachFromCharacter")
}

export function bulkAttachToResourcesMutation() {
	return trpcMutation("tag", "bulkAttachToResource")
}

export function bulkDetachFromResourcesMutation() {
	return trpcMutation("tag", "bulkDetachFromResource")
}

export function bulkAttachToCharactersMutation() {
	return trpcMutation("tag", "bulkAttachToCharacter")
}

export function bulkDetachFromCharactersMutation() {
	return trpcMutation("tag", "bulkDetachFromCharacter")
}
