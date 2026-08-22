import type { UsageEntityType } from "@hoardodile/schemas"
import { cn } from "@hoardodile/ui"
import { ClockCircle, Eye } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { memo } from "react"
import { useTranslation } from "react-i18next"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { formatDurationMs } from "@/lib/formatDuration"
import { usageEntityExposureQueryOptions } from "../api"

type EntityUsageStatsProps = {
	readonly entityType: Extract<
		UsageEntityType,
		"resource" | "character" | "document"
	>
	readonly entityId: string
	readonly className?: string
}

/**
 * The detail hero's usage meta line (icon + text pairs separated by
 * whitespace) — total time, views and last viewed. Rendered even for
 * never-viewed entities, with only the last-viewed item dropped when
 * there is none.
 */
export const EntityUsageStats = memo(function EntityUsageStats(
	props: EntityUsageStatsProps,
) {
	const { entityType, entityId, className } = props
	const { t } = useTranslation()
	const formatter = useDateFormatter()
	const exposureQuery = useQuery(
		usageEntityExposureQueryOptions({ entityType, entityId }),
	)

	if (exposureQuery.isPending) return undefined
	if (exposureQuery.isError || exposureQuery.data === undefined)
		return undefined

	const exposure = exposureQuery.data

	return (
		<div
			className={cn(
				"flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground",
				className,
			)}
			data-testid={`${entityType}-usage-stats`}
		>
			<span className="inline-flex items-center gap-1.5">
				<ClockCircle className="size-4" />
				{t("usage.entityExposure.totalTime", {
					duration: formatDurationMs(exposure.totalMs),
				})}
			</span>
			<span className="inline-flex items-center gap-1.5">
				<Eye className="size-4" />
				{t("usage.entityExposure.views", {
					count: exposure.viewCount,
				})}
			</span>
			{exposure.lastViewedAt !== null ? (
				<span>
					{t("usage.entityExposure.lastViewed", {
						time: formatter.formatDateTime(exposure.lastViewedAt),
					})}
				</span>
			) : null}
		</div>
	)
})
