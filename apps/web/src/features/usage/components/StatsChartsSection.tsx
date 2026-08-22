import { ChartCard } from "@hoardodile/ui/components/chart-card"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { lazy, Suspense, useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useUsageTimeZones } from "@/features/settings/datePrefs"
import { formatCalendarDay } from "@/lib/timezone"
import {
	usageDailySummaryQueryOptions,
	usageHourlyWindowQueryOptions,
	usageTrendQueryOptions,
} from "../api"
import { getRangeBounds, getRangeTrend, type UsageRange } from "../lib/date"
import type { UsagePlatformFilterValue } from "./UsagePlatformFilter"
import { usagePlatformFilterParam } from "./UsagePlatformFilter"

// Chart.js (and the chart components) are fetched only when a chart card
// actually renders — the data queries run eagerly in parallel, so the
// chart chunk lands on the existing skeleton placeholder.
const TrendChart = lazy(() =>
	import("./charts/TrendChart").then((m) => ({ default: m.TrendChart })),
)
const HourlyDistributionChart = lazy(() =>
	import("./charts/HourlyDistributionChart").then((m) => ({
		default: m.HourlyDistributionChart,
	})),
)
const TopEntitiesChart = lazy(() =>
	import("./charts/TopEntitiesChart").then((m) => ({
		default: m.TopEntitiesChart,
	})),
)

type StatsChartsSectionProps = {
	readonly range: UsageRange
	readonly platformFilter: UsagePlatformFilterValue
}

export function StatsChartsSection(props: StatsChartsSectionProps) {
	const { range, platformFilter } = props
	const { t } = useTranslation()
	const { timeZonePref, resolvedTimeZone } = useUsageTimeZones()

	const platform = usagePlatformFilterParam(platformFilter)

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
	})

	const dailySummaryQuery = useQuery({
		...usageDailySummaryQueryOptions({
			date: today,
			limit: 10,
			timeZone: timeZonePref,
			platform,
		}),
		enabled: range === "today",
	})

	const hourlyWindowBounds = useMemo(
		() => getRangeBounds(range, timeZonePref),
		[range, timeZonePref, resolvedTimeZone],
	)
	const hourlyWindowQuery = useQuery({
		...usageHourlyWindowQueryOptions({
			...(hourlyWindowBounds !== undefined
				? { from: hourlyWindowBounds.from, to: hourlyWindowBounds.to }
				: {}),
			timeZone: timeZonePref,
			platform,
		}),
		enabled: range !== "today",
	})

	// Multi-day ranges: usage trend + the window's daily rhythm.
	const trendData = trendQuery.data
	const hasTrendData = trendData?.buckets.some((bucket) => bucket.totalMs > 0)
	const showTrendCard =
		range !== "today" &&
		((trendQuery.isPending && trendInput !== null) || hasTrendData)

	const hourlyWindowData = hourlyWindowQuery.data
	const hasWindowHourlyData = hourlyWindowData?.hourlyMs.some((ms) => ms > 0)
	const showWindowHourlyCard =
		range !== "today" && (hourlyWindowQuery.isPending || hasWindowHourlyData)

	// Today: the hourly distribution + the day's top entities.
	const dailySummaryData = dailySummaryQuery.data
	const hasHourlyData = dailySummaryData?.hourlyMs.some((ms) => ms > 0)
	const showTodayHourlyCard =
		range === "today" && (dailySummaryQuery.isPending || hasHourlyData)
	const showTopEntitiesCard =
		range === "today" &&
		(dailySummaryQuery.isPending ||
			(dailySummaryData?.topEntities.length ?? 0) > 0)

	const visibleCardCount = [
		showTrendCard,
		showWindowHourlyCard,
		showTodayHourlyCard,
		showTopEntitiesCard,
	].filter(Boolean).length

	return (
		<div
			className={cn(
				"mt-8 grid grid-cols-1 gap-6",
				visibleCardCount > 1 && "lg:grid-cols-2",
			)}
			data-testid="stats-charts-section"
		>
			{showTrendCard && (
				<ChartCard
					title={t("usage.stats.trend")}
					subtitle={t("usage.stats.trendDescription")}
				>
					{trendQuery.isPending && trendInput !== null ? (
						<Skeleton className="h-64 w-full" />
					) : hasTrendData ? (
						<div className="h-64 w-full">
							<Suspense fallback={<Skeleton className="h-64 w-full" />}>
								<TrendChart
									granularity={trendData!.granularity}
									data={trendData!.buckets}
									timeZone={timeZonePref}
								/>
							</Suspense>
						</div>
					) : null}
				</ChartCard>
			)}

			{(showWindowHourlyCard || showTodayHourlyCard) && (
				<ChartCard
					title={t(
						range === "today"
							? "usage.stats.todayHourly"
							: "usage.stats.hourlyAverage",
					)}
					subtitle={t(
						range === "today"
							? "usage.stats.todayHourlyDescription"
							: "usage.stats.hourlyAverageDescription",
					)}
				>
					{range === "today" ? (
						dailySummaryQuery.isPending ? (
							<Skeleton className="h-64 w-full" />
						) : hasHourlyData ? (
							<div className="h-64 w-full">
								<Suspense fallback={<Skeleton className="h-64 w-full" />}>
									<HourlyDistributionChart
										data={dailySummaryData!.hourlyMs}
										labels={dailySummaryData!.hourlyLabels}
									/>
								</Suspense>
							</div>
						) : null
					) : hourlyWindowQuery.isPending ? (
						<Skeleton className="h-64 w-full" />
					) : hasWindowHourlyData ? (
						<div className="h-64 w-full">
							<Suspense fallback={<Skeleton className="h-64 w-full" />}>
								<HourlyDistributionChart
									data={hourlyWindowData!.hourlyMs}
									labels={hourlyWindowData!.hourlyLabels}
								/>
							</Suspense>
						</div>
					) : null}
				</ChartCard>
			)}

			{showTopEntitiesCard && (
				<ChartCard
					title={t("usage.stats.topEntities")}
					subtitle={t("usage.stats.topEntitiesDescription")}
				>
					{dailySummaryQuery.isPending ? (
						<Skeleton className="h-64 w-full" />
					) : (dailySummaryData?.topEntities.length ?? 0) > 0 ? (
						<div className="h-64 w-full">
							<Suspense fallback={<Skeleton className="h-64 w-full" />}>
								<TopEntitiesChart rows={dailySummaryData!.topEntities} />
							</Suspense>
						</div>
					) : null}
				</ChartCard>
			)}
		</div>
	)
}
