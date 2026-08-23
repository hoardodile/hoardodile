import { SectionHeader } from "@hoardodile/ui/components/section-header"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import { ClockCircle } from "@hoardodile/ui/icons/registry"
import { keepPreviousData, useQueries } from "@tanstack/react-query"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { PaginationBar } from "@/components/common/PaginationBar"
import {
	dayLabel,
	groupByTimestamp,
	TimelineDayCards,
} from "@/components/common/TimelineDayCards"
import { mergeRecentViewedTotals } from "@/features/overview/lib/mergeRecentViewedTotals"
import { RECENT_VIEWED_ENTITY_TYPES } from "@/features/overview/lib/recentViewedConstants"
import { useResolvedTimeZone } from "@/features/settings/datePrefs"
import { loose } from "@/i18n"
import { usageTotalsPageQueryOptions, usageTotalsQueryOptions } from "../api"
import { UsageHistoryRow } from "./UsageHistoryRow"
import {
	type UsagePlatformFilterValue,
	usagePlatformFilterParam,
} from "./UsagePlatformFilter"

const PAGE_SIZE = 20
/** Depth fetched per entity type for the merged "All" tab (schema max). */
const ALL_TAB_FETCH_LIMIT = 100

type UsageEntityType = (typeof RECENT_VIEWED_ENTITY_TYPES)[number]
type TabValue = "all" | UsageEntityType

const TAB_ORDER: readonly TabValue[] = [
	"all",
	"resource",
	"character",
	"document",
]

const TAB_LABEL_KEYS: Record<
	TabValue,
	| "usage.history.tabs.all"
	| "usage.history.tabs.resources"
	| "usage.history.tabs.characters"
	| "usage.history.tabs.documents"
> = {
	all: "usage.history.tabs.all",
	resource: "usage.history.tabs.resources",
	character: "usage.history.tabs.characters",
	document: "usage.history.tabs.documents",
}

/**
 * Usage history page body, mirroring the footprints timeline's anatomy:
 * an "All" tab plus one tab per entity type, day-grouped rows in quiet
 * card sections, and server-side pagination through `usage.totalsPage`.
 *
 * The "All" tab merges the three types client-side: it fetches a deep
 * window of each type (100) once and slices pages locally, so every page
 * shows a consistent slice of one global recency-ordered list — per-page
 * totalsPage windows would skip entities and leave pages with ragged
 * counts. Entity tabs paginate on the server; `keepPreviousData` keeps
 * the current page visible while the next one loads.
 */
export function UsageHistoryPage(props: {
	readonly platform: UsagePlatformFilterValue
}) {
	const { platform } = props
	const { t } = useTranslation()
	const resolvedTimeZone = useResolvedTimeZone()
	const [tab, setTab] = useState<TabValue>("all")
	const [page, setPage] = useState(1)

	const isAll = tab === "all"
	const activeType = isAll ? undefined : (tab as UsageEntityType)
	const activeTypes = activeType === undefined ? [] : [activeType]
	const platformFilter = usagePlatformFilterParam(platform)

	const entityQueries = useQueries({
		queries: activeTypes.map((entityType) => ({
			...usageTotalsPageQueryOptions({
				entityType,
				granularity: "all",
				order: "recent",
				limit: PAGE_SIZE,
				page,
				platform: platformFilter,
			}),
			placeholderData: keepPreviousData,
		})),
	})

	const allQueries = useQueries({
		queries: RECENT_VIEWED_ENTITY_TYPES.map((entityType) => ({
			...usageTotalsQueryOptions({
				entityType,
				granularity: "all",
				order: "recent",
				limit: ALL_TAB_FETCH_LIMIT,
				platform: platformFilter,
			}),
			enabled: isAll,
		})),
	})

	function selectTab(next: TabValue): void {
		setTab(next)
		setPage(1)
	}

	const merged = useMemo(
		() => mergeRecentViewedTotals(allQueries.map((q) => q.data ?? [])),
		[allQueries],
	)
	const rows = isAll
		? merged.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE)
		: (entityQueries[0]?.data?.rows ?? [])
	const total = isAll ? merged.length : (entityQueries[0]?.data?.total ?? 0)
	const isLoading = isAll
		? allQueries.some((q) => q.isLoading)
		: (entityQueries[0]?.isLoading ?? false)
	const isError = isAll
		? allQueries.some((q) => q.isError)
		: (entityQueries[0]?.isError ?? false)

	const loading = isLoading && rows.length === 0
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

	const groups = useMemo(
		() => groupByTimestamp(rows, (item) => item.lastViewedAt, resolvedTimeZone),
		[rows, resolvedTimeZone],
	)

	return (
		<div className="flex flex-col" data-testid="usage-history-page">
			<SectionHeader
				icon={ClockCircle}
				title={t("usage.history.title")}
				right={
					!isLoading ? (
						<span className="text-xs text-muted-foreground">
							{t("usage.history.totalLabel", { count: total })}
						</span>
					) : undefined
				}
			/>

			<SectionTabs
				value={tab}
				onChange={selectTab}
				className="mt-4"
				items={TAB_ORDER.map((value) => ({
					value,
					label: t(TAB_LABEL_KEYS[value]),
					testId: `usage-history-tab-${value}`,
				}))}
			/>

			{loading ? (
				<p className="py-8 text-center text-sm text-muted-foreground">
					{t("usage.history.loading")}
				</p>
			) : rows.length === 0 ? (
				<p className="py-8 text-center text-sm text-muted-foreground">
					{t("usage.history.empty")}
				</p>
			) : (
				<div className="mt-6" data-testid="usage-history-rows">
					<TimelineDayCards
						groups={groups}
						dayLabel={(day) =>
							day === ""
								? t("usage.history.unknownTime")
								: dayLabel(
										day,
										resolvedTimeZone,
										loose(t),
										"usage.history.today",
										"usage.history.yesterday",
									)
						}
					>
						{(group) =>
							group.items.map((item) => (
								<UsageHistoryRow
									key={`${item.entityType}:${item.entityId}`}
									item={item}
									testId={`usage-history-${item.entityType}-${item.entityId}`}
								/>
							))
						}
					</TimelineDayCards>
				</div>
			)}

			{isError ? (
				<p className="py-4 text-center text-xs text-destructive">
					{t("usage.history.loadError")}
				</p>
			) : null}

			{pageCount > 1 && !isLoading ? (
				<div className="mt-4">
					<PaginationBar
						page={page}
						pageCount={pageCount}
						totalLabel={t("usage.history.totalLabel", { count: total })}
						onChangePage={setPage}
					/>
				</div>
			) : null}
		</div>
	)
}
