import type { UsageEntityType, UsageTotal } from "@hoardodile/schemas"
import type { LeaderboardEntityFilter } from "./statsSearch"

export type ShareMetric = "time" | "views"

export const ENTITY_TYPES: readonly UsageEntityType[] = [
	"resource",
	"character",
	"document",
	"plugin",
]

/**
 * How many top rows per entity kind the share-bar segments fetch. The
 * leaderboard reuses the same window (while it fits within one page) so
 * both queries share a cache key instead of issuing a second request.
 */
export const SHARE_SEGMENTS_LIMIT = 100

/** Rows shown per leaderboard page. */
export const SHARE_LIST_PAGE_SIZE = 10

/**
 * How many top rows per entity kind the leaderboard requests. Within the
 * share bar's fetch window the inputs are identical, so both queries share
 * one cache key; deeper pages ask for exactly what they render.
 */
export function shareListLimit(page: number): number {
	return page * SHARE_LIST_PAGE_SIZE <= SHARE_SEGMENTS_LIMIT
		? SHARE_SEGMENTS_LIMIT
		: page * SHARE_LIST_PAGE_SIZE
}

export const ENTITY_FILTER_OPTIONS: readonly {
	readonly value: LeaderboardEntityFilter
	readonly labelKey: string
}[] = [
	{ value: "all", labelKey: "usage.leaderboard.entityAll" },
	{ value: "resource", labelKey: "usage.leaderboard.entityResources" },
	{ value: "character", labelKey: "usage.leaderboard.entityCharacters" },
	{ value: "document", labelKey: "usage.leaderboard.entityDocuments" },
	{ value: "plugin", labelKey: "usage.leaderboard.entityPlugins" },
]

export function mergeShareTotals(
	rows: readonly UsageTotal[],
	limit: number,
	metric: ShareMetric,
): UsageTotal[] {
	return [...rows]
		.sort((a, b) => {
			if (metric === "views") {
				return b.viewCount - a.viewCount
			}
			return b.totalMs - a.totalMs
		})
		.slice(0, limit)
}

type PeriodViewsInput = {
	readonly range: import("./date").UsageRange
	readonly dailySummary: { readonly sessionCount: number } | undefined
	readonly dashboard: { readonly totalViews: number } | undefined
	readonly trend:
		| { readonly buckets: readonly { readonly sessionCount: number }[] }
		| undefined
}

export function computePeriodTotalViews(input: PeriodViewsInput): number {
	const { range, dailySummary, dashboard, trend } = input
	if (range === "today" && dailySummary !== undefined) {
		return dailySummary.sessionCount
	}
	if (range === "all" && dashboard !== undefined) {
		return dashboard.totalViews
	}
	if (trend !== undefined) {
		return trend.buckets.reduce((sum, b) => sum + b.sessionCount, 0)
	}
	return dashboard?.totalViews ?? 0
}

type PeriodMsInput = {
	readonly range: import("./date").UsageRange
	readonly dailySummary: { readonly totalMs: number } | undefined
	readonly dashboard: { readonly totalMs: number } | undefined
	readonly trend:
		| { readonly buckets: readonly { readonly totalMs: number }[] }
		| undefined
}

export function computePeriodTotalMs(input: PeriodMsInput): number {
	const { range, dailySummary, dashboard, trend } = input
	if (range === "today" && dailySummary !== undefined) {
		return dailySummary.totalMs
	}
	if (range === "all" && dashboard !== undefined) {
		return dashboard.totalMs
	}
	if (trend !== undefined) {
		return trend.buckets.reduce((sum, b) => sum + b.totalMs, 0)
	}
	return dashboard?.totalMs ?? 0
}

export function shareListOrder(metric: ShareMetric): "time" | "views" {
	return metric === "views" ? "views" : "time"
}
