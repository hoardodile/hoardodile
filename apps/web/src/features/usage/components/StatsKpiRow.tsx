import { Icon } from "@hoardodile/ui/components/icon"
import { SecondaryStat } from "@hoardodile/ui/components/secondary-stat"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { GraphDown, GraphUp, PlusMinus } from "@hoardodile/ui/icons/registry"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useUsageTimeZones } from "@/features/settings/datePrefs"
import { loose } from "@/i18n"
import dayjs from "@/lib/dayjs"
import { formatDurationMs } from "@/lib/formatDuration"
import { dayjsFor, formatCalendarDay } from "@/lib/timezone"
import {
	usageDailySummaryQueryOptions,
	usageDashboardQueryOptions,
	usageTrendQueryOptions,
} from "../api"
import { getRangeTrend, type UsageRange } from "../lib/date"
import { computePeriodTotalMs } from "../lib/statsShare"
import {
	computeUsageInsight,
	getUsageInsightComparison,
	getUsageInsightTrendInput,
} from "../lib/usageInsight"
import type { UsagePlatformFilterValue } from "./UsagePlatformFilter"
import { usagePlatformFilterParam } from "./UsagePlatformFilter"

type StatsKpiRowProps = {
	readonly range: UsageRange
	readonly platformFilter: UsagePlatformFilterValue
}

const DELTA_ICONS = {
	up: GraphUp,
	down: GraphDown,
	flat: PlusMinus,
} as const

export function StatsKpiRow(props: StatsKpiRowProps) {
	const { range, platformFilter } = props
	const { t } = useTranslation()
	const { timeZonePref, resolvedTimeZone } = useUsageTimeZones()

	const platform = usagePlatformFilterParam(platformFilter)

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

	const comparison = getUsageInsightComparison(range)
	const insightTrendInput = getUsageInsightTrendInput(range)
	const insightTrendQuery = useQuery({
		...usageTrendQueryOptions(
			insightTrendInput !== null
				? { ...insightTrendInput, timeZone: timeZonePref, platform }
				: {
						granularity: "day",
						periods: 1,
						timeZone: timeZonePref,
						platform,
					},
		),
		enabled: insightTrendInput !== null && comparison !== null,
		placeholderData: keepPreviousData,
	})

	const insight = useMemo(() => {
		if (comparison === null || insightTrendQuery.data === undefined) return null
		return computeUsageInsight(
			insightTrendQuery.data.buckets,
			comparison.comparisonKey,
			range,
		)
	}, [comparison, insightTrendQuery.data])

	const totalMs = useMemo(
		() =>
			computePeriodTotalMs({
				range,
				dailySummary: dailySummaryQuery.data,
				dashboard: dashboardQuery.data,
				trend: trendQuery.data,
			}),
		[range, dailySummaryQuery.data, dashboardQuery.data, trendQuery.data],
	)

	const isTotalPending =
		range === "today"
			? dailySummaryQuery.isPending
			: range === "all"
				? dashboardQuery.isPending
				: trendQuery.isPending

	let insightLabel: string | undefined
	let deltaDirection: keyof typeof DELTA_ICONS = "flat"
	if (insight !== null) {
		const comparisonLabel = loose(t)(insight.comparisonKey)
		if (insight.deltaMs === 0) {
			insightLabel = t("usage.insight.sameAsPeriod", {
				period: comparisonLabel,
			})
		} else if (insight.deltaMs > 0) {
			insightLabel = t("usage.insight.moreThanPeriod", {
				duration: formatDurationMs(insight.deltaMs),
				period: comparisonLabel,
			})
			deltaDirection = "up"
		} else {
			insightLabel = t("usage.insight.lessThanPeriod", {
				duration: formatDurationMs(Math.abs(insight.deltaMs)),
				period: comparisonLabel,
			})
			deltaDirection = "down"
		}
	}

	// Multi-day ranges get the supporting readouts: average per day and the
	// busiest day in the period.
	const dayCount = daysInRange(range, timeZonePref)
	const avgPerDayMs = dayCount > 0 ? totalMs / dayCount : 0
	const mostActiveDay = useMemo(() => {
		const buckets = trendQuery.data?.buckets ?? []
		if (buckets.length === 0) return null
		const busiest = buckets.reduce((a, b) => (b.totalMs > a.totalMs ? b : a))
		return busiest.totalMs > 0 ? busiest : null
	}, [trendQuery.data])
	const showSecondaryStats = trendInput !== null

	return (
		<div
			className="mt-6 flex flex-wrap items-end justify-between gap-x-12 gap-y-6"
			data-testid="stats-kpi-row"
		>
			<div>
				<SectionLabel>{t("usage.stats.totalTime")}</SectionLabel>
				<div
					className="mt-2 text-[44px] leading-none font-bold tracking-tight tabular-nums text-foreground"
					data-testid="stats-kpi-total-time"
				>
					{isTotalPending ? (
						<Skeleton className="h-[1em] w-44" />
					) : (
						formatDurationMs(totalMs)
					)}
				</div>
				{insightLabel !== undefined ? (
					<div className="mt-3 flex items-center gap-1.5 text-ui text-secondary-foreground">
						<Icon icon={DELTA_ICONS[deltaDirection]} size="lg" />
						{insightLabel}
					</div>
				) : null}
			</div>
			{showSecondaryStats ? (
				<div className="flex flex-wrap gap-x-12 gap-y-4 pb-1">
					<SecondaryStat
						label={t("usage.stats.avgPerDay")}
						value={trendQuery.isPending ? "—" : formatDurationMs(avgPerDayMs)}
					/>
					<SecondaryStat
						label={t("usage.stats.mostActiveDay")}
						value={
							trendQuery.isPending || mostActiveDay === null
								? "—"
								: dayjs(mostActiveDay.period).format(
										t("usage.stats.mostActiveDayFormat"),
									)
						}
					/>
				</div>
			) : null}
		</div>
	)
}

function daysInRange(range: UsageRange, timeZone: string): number {
	const now = Date.now()
	switch (range) {
		case "last7days":
		case "thisWeek":
			return 7
		case "thisMonth":
			return dayjsFor(now, timeZone).daysInMonth()
		case "thisYear": {
			const year = dayjsFor(now, timeZone).year()
			const isLeap = (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0
			return isLeap ? 366 : 365
		}
		default:
			return 0
	}
}
