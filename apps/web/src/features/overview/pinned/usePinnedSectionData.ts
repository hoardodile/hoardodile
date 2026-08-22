import { type UseQueryResult, useQueries } from "@tanstack/react-query"
import { useMemo } from "react"
import type { CharCardListResult } from "@/features/char/api"
import { charListCardsQueryOptions } from "@/features/char/api"
import type { ResCardListResult } from "@/features/res/api"
import { resListCardsQueryOptions } from "@/features/res/api"
import type { PinnedSectionItem } from "./types"
import { DEFAULT_PINNED_SIZE } from "./types"

export function buildResourceListInput(item: PinnedSectionItem) {
	return {
		query: item.query ?? "",
		page: 1,
		size: item.size ?? DEFAULT_PINNED_SIZE,
		sortBy: item.sortBy ?? "updated",
		order: item.order ?? "desc",
		random: item.random ?? false,
		tagIds: item.tagIds,
		tagMode: item.tagMode,
		noCharacters: item.noCharacters,
		contentPluginId:
			item.contentPluginId === "" ? undefined : item.contentPluginId,
		searchMetaFacets:
			item.searchMetaFacets && Object.keys(item.searchMetaFacets).length > 0
				? item.searchMetaFacets
				: undefined,
		searchIntro: item.searchIntro,
	}
}

export function buildCharacterListInput(item: PinnedSectionItem) {
	return {
		query: item.query ?? "",
		page: 1,
		size: item.size ?? DEFAULT_PINNED_SIZE,
		sortBy: item.sortBy ?? "updated",
		order: item.order ?? "desc",
		random: item.random ?? false,
		tagIds: item.tagIds,
		tagMode: item.tagMode,
		traitFilters: item.traitFilters,
		searchIntro: item.searchIntro,
		relationshipTypeIds: item.relationshipTypeIds,
	}
}

export type PinnedResourceItemData = {
	readonly item: PinnedSectionItem
	readonly query: UseQueryResult<ResCardListResult, Error>
}

export type PinnedCharacterItemData = {
	readonly item: PinnedSectionItem
	readonly query: UseQueryResult<CharCardListResult, Error>
}

function isEnabledItem(item: PinnedSectionItem): boolean {
	return item.enabled !== false
}

export function isVisibleItem(
	item: PinnedSectionItem,
	query: UseQueryResult<{ readonly rows: readonly unknown[] }, Error>,
): boolean {
	if (!isEnabledItem(item)) return false
	if (query.isPending) return false
	if (item.showWhenEmpty) return true
	return (query.data?.rows.length ?? 0) > 0
}

export function usePinnedResourcesItemsWithQueries(
	items: readonly PinnedSectionItem[],
	enabled = true,
): PinnedResourceItemData[] {
	const inputs = useMemo(() => items.map(buildResourceListInput), [items])
	const queries = useQueries({
		queries: inputs.map((input) => ({
			...resListCardsQueryOptions({ ...input, trash: false }),
			enabled,
		})),
	})

	return useMemo(
		() =>
			items.map((item, index) => ({
				item,
				query: queries[index] as UseQueryResult<ResCardListResult, Error>,
			})),
		[items, queries],
	)
}

export function usePinnedCharactersItemsWithQueries(
	items: readonly PinnedSectionItem[],
	enabled = true,
): PinnedCharacterItemData[] {
	const inputs = useMemo(() => items.map(buildCharacterListInput), [items])
	const queries = useQueries({
		queries: inputs.map((input) => ({
			...charListCardsQueryOptions({ ...input, trash: false }),
			enabled,
		})),
	})

	return useMemo(
		() =>
			items.map((item, index) => ({
				item,
				query: queries[index] as UseQueryResult<CharCardListResult, Error>,
			})),
		[items, queries],
	)
}
