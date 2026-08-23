import type { UsageEntityType, UsageExposureMode } from "@hoardodile/schemas"
import { useQueries } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { useUsageTimeZones } from "@/features/settings/datePrefs"
import type { Translate } from "@/i18n"
import { usageTotalsQueryOptions } from "../api"
import {
	getRangeListTotalsInput,
	toUsageTotalsInput,
	type UsageRange,
} from "../lib/date"
import type { ShareMetric } from "../lib/statsShare"
import { ENTITY_TYPES, SHARE_SEGMENTS_LIMIT } from "../lib/statsShare"
import type { UsagePlatformFilterValue } from "./UsagePlatformFilter"
import { usagePlatformFilterParam } from "./UsagePlatformFilter"

/** Stepped ramp of the chart ink for stacked-share segments (index → fill). */
const SHARE_RAMP = [
	"bg-chart/85",
	"bg-chart/55",
	"bg-chart/35",
	"bg-chart/22",
	"bg-chart/12",
] as const

export type UsageShareSegments = readonly {
	readonly label: string
	readonly value: number
}[]

export function useUsageShareSegments(input: {
	readonly range: UsageRange
	readonly platformFilter: UsagePlatformFilterValue
	readonly exposureMode: UsageExposureMode
	readonly metric: ShareMetric
}): { readonly segments: UsageShareSegments; readonly total: number } {
	const { range, platformFilter, exposureMode, metric } = input
	const { t } = useTranslation()
	const { timeZonePref } = useUsageTimeZones()
	const platform = usagePlatformFilterParam(platformFilter)

	const periodInput = getRangeListTotalsInput(range, timeZonePref)
	const queries = useQueries({
		queries: ENTITY_TYPES.map((entityType) =>
			usageTotalsQueryOptions(
				toUsageTotalsInput(entityType, periodInput, {
					order: metric === "views" ? "views" : "time",
					limit: SHARE_SEGMENTS_LIMIT,
					timeZone: timeZonePref,
					platform,
					exposureMode,
				}),
			),
		),
	})

	const segments = ENTITY_TYPES.map((entityType, index) => {
		const rows = queries[index]?.data ?? []
		const value = rows.reduce(
			(sum, row) => sum + (metric === "views" ? row.viewCount : row.totalMs),
			0,
		)
		return {
			label: entityLabel(entityType, t),
			value,
		}
	})

	const total = segments.reduce((sum, segment) => sum + segment.value, 0)
	return { segments, total }
}

type UsageShareBarProps = {
	readonly segments: UsageShareSegments
	readonly total: number
}

/**
 * The stacked share bar: how the period's usage splits across
 * entity kinds, drawn as a chart-ink ramp with a dotted legend. Fed by
 * {@link useUsageShareSegments}; renders nothing when the period has no
 * usage at all.
 */
export function UsageShareBar(props: UsageShareBarProps) {
	const { segments, total } = props
	if (total <= 0) return null

	return (
		<div data-testid="usage-share-bar">
			<div className="flex h-2 w-full overflow-hidden rounded-full">
				{segments.map((segment, index) =>
					segment.value > 0 ? (
						<div
							key={segment.label}
							className={SHARE_RAMP[index % SHARE_RAMP.length]}
							style={{ width: `${(segment.value / total) * 100}%` }}
						/>
					) : null,
				)}
			</div>
			<div className="mt-3 flex flex-wrap gap-x-5 gap-y-1">
				{segments.map((segment, index) =>
					segment.value > 0 ? (
						<span
							key={segment.label}
							className="flex items-center gap-1.5 text-tiny text-muted-foreground"
						>
							<span
								className={`size-2 rounded-full ${SHARE_RAMP[index % SHARE_RAMP.length]}`}
							/>
							{segment.label}
							<span className="tabular-nums">
								{Math.round((segment.value / total) * 100)}%
							</span>
						</span>
					) : null,
				)}
			</div>
		</div>
	)
}

function entityLabel(entityType: UsageEntityType, t: Translate): string {
	switch (entityType) {
		case "resource":
			return t("usage.leaderboard.entityResources")
		case "character":
			return t("usage.leaderboard.entityCharacters")
		case "document":
			return t("usage.leaderboard.entityDocuments")
		case "plugin":
			return t("usage.leaderboard.entityPlugins")
	}
}
