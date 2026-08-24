import type { UsageExposureMode, UsageTotal } from "@hoardodile/schemas"
import { PaginationBar } from "@hoardodile/ui/components/pagination-bar"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { SectionHeader } from "@hoardodile/ui/components/section-header"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Spinner } from "@hoardodile/ui/components/spinner"
import { PieChart } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { keepPreviousData, useQueries, useQuery } from "@tanstack/react-query"
import { Link, useNavigate } from "@tanstack/react-router"
import { useEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { useUsageTimeZones } from "@/features/settings/datePrefs"
import { loose } from "@/i18n"
import { formatCalendarDay } from "@/lib/timezone"
import {
	usageDailySummaryQueryOptions,
	usageDashboardQueryOptions,
	usageTotalsPageQueryOptions,
	usageTotalsQueryOptions,
	usageTrendQueryOptions,
} from "../api"
import {
	getRangeListTotalsInput,
	getRangeTrend,
	toUsageTotalsInput,
	type UsageRange,
} from "../lib/date"
import {
	buildStatsSearch,
	type LeaderboardEntityFilter,
	type StatsSearch,
	type StatsSearchPatch,
} from "../lib/statsSearch"
import {
	computePeriodTotalMs,
	computePeriodTotalViews,
	ENTITY_FILTER_OPTIONS,
	ENTITY_TYPES,
	mergeShareTotals,
	SHARE_LIST_PAGE_SIZE,
	shareListLimit,
	shareListOrder,
} from "../lib/statsShare"
import { UsageLeaderboardRow } from "./UsageLeaderboardRow"
import type { UsagePlatformFilterValue } from "./UsagePlatformFilter"
import { usagePlatformFilterParam } from "./UsagePlatformFilter"
import { UsageShareBar, useUsageShareSegments } from "./UsageShareBar"

type StatsShareSectionProps = {
	readonly search: StatsSearch
	readonly range: UsageRange
	readonly platformFilter: UsagePlatformFilterValue
	readonly exposureMode: UsageExposureMode
	readonly entityFilter: LeaderboardEntityFilter
}

type StaleShareView = {
	readonly items: readonly UsageTotal[]
	readonly total: number
	readonly denominator: number
	readonly metric: StatsSearch["shareMetric"]
	readonly entityFilter: LeaderboardEntityFilter
	readonly range: UsageRange
}

export function StatsShareSection(props: StatsShareSectionProps) {
	const { search, range, platformFilter, exposureMode, entityFilter } = props
	const metric = search.shareMetric
	const page = search.sharePage ?? 1
	const { t } = useTranslation()
	const { timeZonePref, resolvedTimeZone } = useUsageTimeZones()
	const platform = usagePlatformFilterParam(platformFilter)
	const navigate = useNavigate()

	const dashboardQuery = useQuery({
		...usageDashboardQueryOptions({ platform }),
		// Only the all-time range reads the dashboard; other ranges sum the
		// trend buckets, so skip the five all-time aggregates per switch.
		enabled: range === "all",
		placeholderData: keepPreviousData,
	})

	const today = useMemo(
		() => formatCalendarDay(Date.now(), timeZonePref),
		[timeZonePref, resolvedTimeZone],
	)

	const trendInput = useMemo(
		() => getRangeTrend(range, timeZonePref),
		[range, timeZonePref, resolvedTimeZone],
	)
	const trendQuery = useQuery({
		...usageTrendQueryOptions(
			trendInput !== null
				? { ...trendInput, timeZone: timeZonePref, platform }
				: {
						granularity: "day",
						periods: 1,
						timeZone: timeZonePref,
						platform,
					},
		),
		enabled: trendInput !== null,
		placeholderData: keepPreviousData,
	})

	const dailySummaryQuery = useQuery({
		...usageDailySummaryQueryOptions({
			date: today,
			limit: 10,
			timeZone: timeZonePref,
			platform,
		}),
		enabled: range === "today",
		placeholderData: keepPreviousData,
	})

	const denominator = useMemo(() => {
		const periodInput = {
			range,
			dailySummary: dailySummaryQuery.data,
			dashboard: dashboardQuery.data,
			trend: trendQuery.data,
		}
		return metric === "views"
			? computePeriodTotalViews(periodInput)
			: computePeriodTotalMs(periodInput)
	}, [
		metric,
		range,
		dailySummaryQuery.data,
		dashboardQuery.data,
		trendQuery.data,
	])

	const periodInput = useMemo(
		() => getRangeListTotalsInput(range, timeZonePref),
		[range, timeZonePref, resolvedTimeZone],
	)

	const shareSegments = useUsageShareSegments({
		range,
		platformFilter,
		exposureMode,
		metric,
	})

	const listOrder = shareListOrder(metric)

	const listTotalsBase = useMemo(
		() => ({
			listTotals: periodInput,
			order: listOrder,
			timeZone: timeZonePref,
			platform,
			exposureMode,
		}),
		[periodInput, listOrder, timeZonePref, platform, exposureMode],
	)

	const singleQuery = useQuery({
		...usageTotalsPageQueryOptions(
			toUsageTotalsInput(
				entityFilter === "all" ? "resource" : entityFilter,
				listTotalsBase.listTotals,
				{
					...listTotalsBase,
					limit: SHARE_LIST_PAGE_SIZE,
					page,
				},
			),
		),
		enabled: entityFilter !== "all",
		placeholderData: keepPreviousData,
	})

	const allQueries = useQueries({
		queries: ENTITY_TYPES.map((entityType) => ({
			...usageTotalsQueryOptions(
				toUsageTotalsInput(entityType, listTotalsBase.listTotals, {
					...listTotalsBase,
					// Within the share bar's fetch window the inputs are
					// identical, so both queries share one cache key; only
					// deeper pages ask for more rows.
					limit: shareListLimit(page),
				}),
			),
			enabled: entityFilter === "all",
			placeholderData: keepPreviousData,
		})),
	})

	const pageState = useMemo(() => {
		if (entityFilter !== "all") {
			const data = singleQuery.data
			return {
				items: data?.rows ?? [],
				total: data?.total ?? 0,
				// A placeholder carries the previous key's data â€” treat it
				// as loading so range/entity switches show the skeleton
				// instead of numbers that do not match the active filters.
				isLoading: singleQuery.isLoading || singleQuery.isPlaceholderData,
			}
		}
		const merged: UsageTotal[] = []
		for (const query of allQueries) {
			if (query.data !== undefined) {
				for (const row of query.data) {
					merged.push(row)
				}
			}
		}
		const sorted = mergeShareTotals(merged, merged.length, metric)
		const start = (page - 1) * SHARE_LIST_PAGE_SIZE
		const end = start + SHARE_LIST_PAGE_SIZE
		return {
			items: sorted.slice(start, end),
			total: sorted.length,
			isLoading: allQueries.some((q) => q.isLoading || q.isPlaceholderData),
		}
	}, [
		entityFilter,
		singleQuery.data,
		singleQuery.isLoading,
		singleQuery.isPlaceholderData,
		allQueries,
		metric,
		page,
	])

	const staleViewRef = useRef<StaleShareView | null>(null)

	useEffect(() => {
		if (!pageState.isLoading && pageState.items.length > 0) {
			staleViewRef.current = {
				items: pageState.items,
				total: pageState.total,
				denominator,
				metric,
				entityFilter,
				range,
			}
		}
	}, [
		pageState.isLoading,
		pageState.items,
		pageState.total,
		denominator,
		metric,
		entityFilter,
		range,
	])

	const staleView = staleViewRef.current
	const isStale = pageState.isLoading && staleView !== null
	const displayItems = isStale ? staleView.items : pageState.items
	const displayTotal = isStale ? staleView.total : pageState.total
	const displayDenominator = isStale ? staleView.denominator : denominator

	const pageCount = Math.max(1, Math.ceil(displayTotal / SHARE_LIST_PAGE_SIZE))
	const showPagination =
		displayTotal > SHARE_LIST_PAGE_SIZE && !pageState.isLoading

	function buildShareSearch(patch: StatsSearchPatch) {
		return buildStatsSearch(search, patch)
	}

	const showSkeleton = pageState.isLoading && !isStale
	const showEmpty =
		!pageState.isLoading &&
		(displayDenominator <= 0 || displayItems.length === 0)

	return (
		<div className="mt-8 flex flex-col" data-testid="usage-share-breakdown">
			<SectionHeader
				icon={PieChart}
				title={t("usage.stats.shareSectionTitle")}
				right={
					<PillTabs
						value={metric}
						items={[
							{
								value: "time",
								label: t("usage.stats.shareTitle"),
								render: (active, className) => (
									<Link
										to="/stats"
										search={buildShareSearch({
											shareMetric: "time",
											sharePage: 1,
										})}
										resetScroll={false}
										className={className}
										aria-current={active ? "page" : undefined}
									>
										{t("usage.stats.shareTitle")}
									</Link>
								),
							},
							{
								value: "views",
								label: t("usage.stats.viewShareTitle"),
								render: (active, className) => (
									<Link
										to="/stats"
										search={buildShareSearch({
											shareMetric: "views",
											sharePage: 1,
										})}
										resetScroll={false}
										className={className}
										aria-current={active ? "page" : undefined}
									>
										{t("usage.stats.viewShareTitle")}
									</Link>
								),
							},
						]}
					/>
				}
			/>

			<SectionTabs
				value={entityFilter}
				className="mt-4"
				items={ENTITY_FILTER_OPTIONS.map((option) => ({
					value: option.value,
					label: loose(t)(option.labelKey),
					render: (active, className, trigger) => (
						<Link
							{...trigger}
							to="/stats"
							search={buildShareSearch({
								entityType: option.value,
								sharePage: 1,
							})}
							resetScroll={false}
							className={className}
							aria-current={active ? "page" : undefined}
						>
							{loose(t)(option.labelKey)}
						</Link>
					),
				}))}
			/>

			{/* The share bar and the ranked rows split into two cards â€” the
			    bar answers "how is it split", the list who is in it. The bar
			    card is dropped entirely when the period has no usage. */}
			{entityFilter === "all" && shareSegments.total > 0 ? (
				<div className="mt-6 rounded-xl border border-border bg-card p-6 shadow-card">
					<UsageShareBar
						segments={shareSegments.segments}
						total={shareSegments.total}
					/>
				</div>
			) : null}

			<div className="mt-6 rounded-xl border border-border bg-card p-6 shadow-card">
				{showSkeleton ? (
					<div className="flex flex-col gap-2">
						{Array.from({ length: 3 }).map((_, i) => (
							<Skeleton key={i} className="h-12 w-full" />
						))}
					</div>
				) : showEmpty ? (
					<p className="py-2 text-sm text-muted-foreground">
						{t("usage.leaderboard.empty")}
					</p>
				) : (
					<div className={cn("flex flex-col", isStale && "opacity-50")}>
						{displayItems.map((total, index) => (
							<UsageLeaderboardRow
								key={`${total.entityType}-${total.entityId}`}
								rank={(page - 1) * SHARE_LIST_PAGE_SIZE + index + 1}
								total={total}
								metric={metric}
								denominator={displayDenominator}
								exposureMode={exposureMode}
							/>
						))}
					</div>
				)}

				{isStale ? (
					<div className="flex items-center justify-center py-4">
						<Spinner className="size-6 text-muted-foreground" />
					</div>
				) : null}

				{showPagination ? (
					<div className="mt-4">
						<PaginationBar
							page={page}
							pageCount={pageCount}
							onChangePage={(next) =>
								void navigate({
									to: "/stats",
									search: buildShareSearch({ sharePage: next }),
									replace: true,
									resetScroll: false,
								})
							}
							totalLabel={t("usage.stats.entries", {
								count: displayTotal,
							})}
						/>
					</div>
				) : null}
			</div>

			{/* The rankings honor the selected counting mode; the totals and
			    charts above always count direct sessions. */}
			<p className="mt-4 text-xs text-muted-foreground">
				{t("usage.stats.exposureModeNote")}
			</p>
		</div>
	)
}
