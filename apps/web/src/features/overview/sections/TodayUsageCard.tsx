import { Icon } from "@hoardodile/ui/components/icon"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Surface } from "@hoardodile/ui/components/surface"
import { ClockCircle } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { useUsageTimeZones } from "@/features/settings/datePrefs"
import {
	usageDailySummaryQueryOptions,
	usageTrendQueryOptions,
} from "@/features/usage/api"
import {
	computeUsageInsight,
	getUsageInsightComparison,
} from "@/features/usage/lib/usageInsight"
import { loose } from "@/i18n"
import { formatDurationMs } from "@/lib/formatDuration"
import { dayjsFor, formatCalendarDay } from "@/lib/timezone"

type TodayUsageCardProps = {
	readonly variant?: "default" | "compact"
}

export function TodayUsageCard(props: TodayUsageCardProps) {
	const variant = props.variant ?? "default"
	const { t } = useTranslation()
	const { timeZonePref, resolvedTimeZone } = useUsageTimeZones()
	const today = useMemo(
		() => formatCalendarDay(Date.now(), timeZonePref),
		[timeZonePref, resolvedTimeZone],
	)
	const yesterday = useMemo(
		() =>
			dayjsFor(Date.now(), timeZonePref)
				.subtract(1, "day")
				.format("YYYY-MM-DD"),
		[timeZonePref, resolvedTimeZone],
	)

	const todayQuery = useQuery(
		usageDailySummaryQueryOptions({
			date: today,
			limit: 1,
			timeZone: timeZonePref,
		}),
	)
	const yesterdayQuery = useQuery(
		usageDailySummaryQueryOptions({
			date: yesterday,
			limit: 1,
			timeZone: timeZonePref,
		}),
	)
	const weekTrendQuery = useQuery(
		usageTrendQueryOptions({
			granularity: "week",
			periods: 2,
			timeZone: timeZonePref,
		}),
	)

	const isLoading = todayQuery.isPending
	const todayMs = todayQuery.data?.totalMs ?? 0
	const yesterdayMs = yesterdayQuery.data?.totalMs ?? 0
	const deltaMs = todayMs - yesterdayMs

	const deltaLabel =
		deltaMs === 0
			? t("overview.todayUsage.sameAsYesterday")
			: deltaMs > 0
				? t("overview.todayUsage.moreThanYesterday", {
						duration: formatDurationMs(deltaMs),
					})
				: t("overview.todayUsage.lessThanYesterday", {
						duration: formatDurationMs(Math.abs(deltaMs)),
					})

	const weekComparison = getUsageInsightComparison("thisWeek")
	const weekInsight =
		weekComparison !== null && weekTrendQuery.data !== undefined
			? computeUsageInsight(
					weekTrendQuery.data.buckets,
					weekComparison.comparisonKey,
				)
			: null

	const weekInsightLabel =
		weekInsight === null
			? undefined
			: weekInsight.deltaMs === 0
				? t("usage.insight.sameAsPeriod", {
						period: loose(t)(weekInsight.comparisonKey),
					})
				: weekInsight.deltaMs > 0
					? t("usage.insight.moreThanPeriod", {
							duration: formatDurationMs(weekInsight.deltaMs),
							period: loose(t)(weekInsight.comparisonKey),
						})
					: t("usage.insight.lessThanPeriod", {
							duration: formatDurationMs(Math.abs(weekInsight.deltaMs)),
							period: loose(t)(weekInsight.comparisonKey),
						})

	const isCompact = variant === "compact"
	const href = { to: "/stats", search: { range: "today" } }

	if (isCompact) {
		// Watch card: the only floating card on the dashboard.
		// Width hugs the content (mockup `.watch-card` is `flex: none` with no
		// width declaration) so translations and long durations size it.
		const watchCard = (
			<div
				className="w-full rounded-xl border border-border bg-card px-6 py-5 shadow-card transition-colors hover:bg-muted/30 sm:w-fit sm:flex-none"
				data-testid="overview-today-usage"
			>
				<div className="flex items-center gap-2 text-xs text-muted-foreground">
					<Icon icon={ClockCircle} />
					{t("overview.todayUsage.label")}
				</div>
				<div className="mt-2 text-[32px] font-bold leading-[1.15]">
					{isLoading ? (
						<Skeleton className="h-[1em] w-24 rounded" />
					) : (
						formatDurationMs(todayMs)
					)}
				</div>
				<div className="mt-1 text-xs text-muted-foreground">
					{isLoading || yesterdayQuery.isPending ? (
						<Skeleton className="h-[1em] w-32 rounded" />
					) : (
						deltaLabel
					)}
				</div>
			</div>
		)

		if (isLoading) {
			return watchCard
		}

		return (
			<Link {...href} className="block w-full sm:w-fit">
				{watchCard}
			</Link>
		)
	}

	const content = (
		<>
			<div
				className={cn(
					"flex shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary",
					isCompact ? "size-8" : "size-10",
				)}
			>
				<Icon icon={ClockCircle} className={isCompact ? "size-4" : "size-5"} />
			</div>
			<div className={cn("min-w-0", !isCompact && "flex-1")}>
				<div
					className={cn(
						"text-muted-foreground",
						isCompact ? "text-xs leading-tight" : "text-sm",
					)}
				>
					{t("overview.todayUsage.label")}
				</div>
				<div
					className={cn(
						"font-semibold tabular-nums",
						isCompact ? "text-sm leading-tight" : "text-xl",
					)}
				>
					{isLoading ? (
						<Skeleton
							className={cn(
								"h-[1em] w-16 rounded",
								isCompact ? "mt-0.5" : "mt-1",
							)}
						/>
					) : (
						formatDurationMs(todayMs)
					)}
				</div>
				<div
					className={cn(
						"text-muted-foreground",
						isCompact ? "text-xs leading-tight" : "text-xs",
					)}
				>
					{isLoading || yesterdayQuery.isPending ? (
						<Skeleton
							className={cn(
								"h-[1em] w-24 rounded",
								isCompact ? "mt-0.5" : "mt-0.5",
							)}
						/>
					) : (
						deltaLabel
					)}
				</div>
				{!isCompact && weekInsightLabel !== undefined ? (
					<div className="text-xs text-muted-foreground">
						{isLoading || weekTrendQuery.isPending ? (
							<Skeleton className="mt-0.5 h-[1em] w-32 rounded" />
						) : (
							weekInsightLabel
						)}
					</div>
				) : null}
			</div>
		</>
	)

	const surfaceClassName = cn(
		"flex items-center",
		isCompact ? "min-h-16 gap-2" : "min-h-24 gap-4",
	)

	if (isLoading) {
		return (
			<Surface
				size="compact"
				className={surfaceClassName}
				data-testid="overview-today-usage"
			>
				{content}
			</Surface>
		)
	}

	return (
		<Link {...href} className="block">
			<Surface
				size="compact"
				className={cn(surfaceClassName, "transition-colors hover:bg-muted/30")}
				data-testid="overview-today-usage"
			>
				{content}
			</Surface>
		</Link>
	)
}
