import { Icon } from "@hoardodile/ui/components/icon"
import { SecondaryStat } from "@hoardodile/ui/components/secondary-stat"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { GraphDown, GraphUp, PlusMinus } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useUsageTimeZones } from "@/features/settings/datePrefs"
import {
	type UsagePlatformFilterValue,
	usagePlatformFilterParam,
} from "@/features/usage/components/UsagePlatformFilter"
import dayjs from "@/lib/dayjs"
import { traceReportQueryOptions } from "../api"
import { TRACE_ACTION_META, type TraceAction } from "../lib/actionMeta"

type OverviewRange = "today" | "last7days" | "thisMonth" | "thisYear"

const OVERVIEW_RANGES: {
	readonly value: OverviewRange
	readonly granularity: "day" | "month" | "year"
	/** Trailing periods: day ranges carry a trail (and its delta span). */
	readonly periods: number
}[] = [
	{ value: "today", granularity: "day", periods: 7 },
	{ value: "last7days", granularity: "day", periods: 14 },
	{ value: "thisMonth", granularity: "month", periods: 2 },
	{ value: "thisYear", granularity: "year", periods: 2 },
]

const TRAIL_DAYS = 7
const RESTORE_ACTIONS: readonly TraceAction[] = [
	"resource.restore",
	"comment.restore",
	"document.restore",
	"character.restore",
]

/** The trail tiles' quiet tint ramp — one step per level of activity,
    below the inverted busiest day. */
const TILE_TINTS = ["bg-chart/12", "bg-chart/20", "bg-chart/30"] as const

const DELTA_ICONS = {
	up: GraphUp,
	down: GraphDown,
	flat: PlusMinus,
} as const

type ActionCount = { readonly action: TraceAction; readonly count: number }

/**
 * The footprints overview: the selected period's action
 * count as a big numeral with its delta against the previous period, the
 * quiet supporting stats, and — for day periods — the trailing-week trail
 * of tiles with the busiest day inverted.
 */
export function TraceOverviewSection(props: {
	readonly platform: UsagePlatformFilterValue
}) {
	const { platform } = props
	const { t } = useTranslation()
	const { resolvedTimeZone } = useUsageTimeZones()
	const [range, setRange] = useState<OverviewRange>("today")
	const config = OVERVIEW_RANGES.find((r) => r.value === range)
	if (config === undefined) {
		throw new Error(`unknown overview range: ${range}`)
	}

	const reportQuery = useQuery(
		traceReportQueryOptions({
			granularity: config.granularity,
			periods: config.periods,
			timeZone: resolvedTimeZone,
			platform: usagePlatformFilterParam(platform),
		}),
	)

	const buckets = reportQuery.data ?? []
	const isDay = config.granularity === "day"
	const trailBuckets = isDay ? buckets.slice(-TRAIL_DAYS) : []
	const lastBucket = buckets.at(-1)
	const secondLastBucket = buckets.at(-2)
	const periodBuckets =
		range === "last7days"
			? trailBuckets
			: lastBucket !== undefined
				? [lastBucket]
				: []
	const previousBuckets =
		range === "last7days"
			? buckets.slice(0, Math.max(0, buckets.length - TRAIL_DAYS))
			: secondLastBucket !== undefined
				? [secondLastBucket]
				: []

	const spanCount = sumRows(periodBuckets)
	const previousCount = sumRows(previousBuckets)
	const delta = spanCount - previousCount

	const rows = aggregateRows(periodBuckets)
	const busiest = [...rows.entries()].reduce(
		(max, [action, count]) => (count > max.count ? { action, count } : max),
		{ action: undefined as TraceAction | undefined, count: 0 },
	)
	const restores = RESTORE_ACTIONS.reduce(
		(sum, action) => sum + (rows.get(action) ?? 0),
		0,
	)
	const weekTotal = isDay ? sumRows(trailBuckets) : undefined
	const avgPerDay =
		range === "last7days" && trailBuckets.length > 0
			? Math.round(spanCount / trailBuckets.length)
			: undefined

	const trailMax = Math.max(
		0,
		...trailBuckets.map((bucket) => sumRows([bucket])),
	)

	const deltaLabel =
		delta === 0
			? t("trace.overview.sameAsPrev")
			: delta > 0
				? t("trace.overview.moreThanPrev", { count: delta })
				: t("trace.overview.lessThanPrev", { count: Math.abs(delta) })

	return (
		<div className="flex flex-col" data-testid="trace-overview">
			<SectionTabs
				value={range}
				onChange={(value) => setRange(value as OverviewRange)}
				items={OVERVIEW_RANGES.map((r) => ({
					value: r.value,
					label: t(`trace.overview.${r.value}`),
				}))}
			/>

			<div className="mt-6 flex flex-wrap items-end justify-between gap-x-12 gap-y-6">
				<div>
					<SectionLabel>{t(`trace.overview.actions.${range}`)}</SectionLabel>
					<div
						className="mt-2 text-[44px] leading-none font-bold tracking-tight tabular-nums text-foreground"
						data-testid="trace-kpi-count"
					>
						{reportQuery.isPending ? (
							<Skeleton className="h-[1em] w-28" />
						) : (
							spanCount
						)}
					</div>
					<div className="mt-3 flex items-center gap-1.5 text-ui text-secondary-foreground">
						<Icon
							icon={DELTA_ICONS[delta > 0 ? "up" : delta < 0 ? "down" : "flat"]}
							size="lg"
						/>
						{deltaLabel}
					</div>
				</div>
				<div className="flex flex-wrap gap-x-12 gap-y-4 pb-1">
					<SecondaryStat
						label={t("trace.overview.busiestKind")}
						value={
							busiest.action !== undefined
								? `${t(TRACE_ACTION_META[busiest.action].filterKey)} · ${busiest.count}`
								: "—"
						}
					/>
					<SecondaryStat
						label={t("trace.overview.restores")}
						value={String(restores)}
					/>
					{weekTotal !== undefined ? (
						<SecondaryStat
							label={t("trace.overview.weekTotal")}
							value={String(weekTotal)}
						/>
					) : avgPerDay !== undefined ? (
						<SecondaryStat
							label={t("trace.overview.avgPerDay")}
							value={String(avgPerDay)}
						/>
					) : null}
				</div>
			</div>

			{trailBuckets.length > 0 ? (
				<div className="mt-8 flex gap-2">
					{trailBuckets.map((bucket) => {
						const value = sumRows([bucket])
						const isBusiest = value > 0 && value === trailMax
						return (
							<div
								key={bucket.period}
								className="flex min-w-0 flex-1 flex-col items-center gap-1.5"
							>
								<span
									className={cn(
										"flex h-10 w-full items-center justify-center rounded-lg text-ui font-medium tabular-nums",
										isBusiest
											? "bg-foreground text-background"
											: TILE_TINTS[Math.min(2, Math.max(0, value - 1))],
									)}
								>
									{value}
								</span>
								<span className="truncate text-tiny text-muted-foreground">
									{dayjs(bucket.period).format("ddd")}
								</span>
							</div>
						)
					})}
				</div>
			) : null}
		</div>
	)
}

function sumRows(
	buckets: readonly { readonly rows: readonly ActionCount[] }[],
): number {
	return buckets.reduce(
		(sum, bucket) =>
			sum + bucket.rows.reduce((rowSum, row) => rowSum + row.count, 0),
		0,
	)
}

function aggregateRows(
	buckets: readonly { readonly rows: readonly ActionCount[] }[],
): Map<TraceAction, number> {
	const counts = new Map<TraceAction, number>()
	for (const bucket of buckets) {
		for (const row of bucket.rows) {
			counts.set(row.action, (counts.get(row.action) ?? 0) + row.count)
		}
	}
	return counts
}
