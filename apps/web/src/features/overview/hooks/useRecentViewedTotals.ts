import { useQueries } from "@tanstack/react-query"
import { useMemo } from "react"
import { charDetailCardQueryOptions } from "@/features/char"
import { docNodeViewQueryOptions } from "@/features/doc"
import { resDetailCardQueryOptions } from "@/features/res"
import { usageTotalsQueryOptions } from "@/features/usage/api"
import { mergeRecentViewedTotals } from "../lib/mergeRecentViewedTotals"
import {
	RECENT_VIEWED_ENTITY_TYPES,
	RECENT_VIEWED_FETCH_LIMIT,
	RECENT_VIEWED_SECTION_LIMIT,
} from "../lib/recentViewedConstants"

export function useRecentViewedTotals() {
	const queries = useQueries({
		queries: RECENT_VIEWED_ENTITY_TYPES.map((entityType) =>
			usageTotalsQueryOptions({
				entityType,
				granularity: "all",
				order: "recent",
				limit: RECENT_VIEWED_FETCH_LIMIT,
			}),
		),
	})

	const resourceRows = queries[0]?.data
	const characterRows = queries[1]?.data
	const documentRows = queries[2]?.data

	const items = useMemo(
		() =>
			mergeRecentViewedTotals([
				resourceRows ?? [],
				characterRows ?? [],
				documentRows ?? [],
			]),
		[resourceRows, characterRows, documentRows],
	)

	const isTotalsPending = queries.some((query) => query.isPending)

	const sectionItems = useMemo(
		() => items.slice(0, RECENT_VIEWED_SECTION_LIMIT),
		[items],
	)

	const nameQueries = useQueries({
		queries: [
			...sectionItems
				.filter((item) => item.entityType === "resource")
				.map((item) => ({
					...resDetailCardQueryOptions(item.entityId),
					enabled: !isTotalsPending,
				})),
			...sectionItems
				.filter((item) => item.entityType === "character")
				.map((item) => ({
					...charDetailCardQueryOptions(item.entityId),
					enabled: !isTotalsPending,
				})),
			...sectionItems
				.filter((item) => item.entityType === "document")
				.map((item) => ({
					...docNodeViewQueryOptions(item.entityId),
					enabled: !isTotalsPending,
				})),
		],
	})

	const isNamesPending =
		!isTotalsPending &&
		sectionItems.length > 0 &&
		nameQueries.some((query) => query.isPending)

	return { items, isPending: isTotalsPending || isNamesPending }
}
