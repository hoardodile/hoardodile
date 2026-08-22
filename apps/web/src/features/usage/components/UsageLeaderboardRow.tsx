import type {
	UsageEntityType,
	UsageExposureMode,
	UsageTotal,
} from "@hoardodile/schemas"
import {
	DocumentText,
	Gallery,
	PlugCircle,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { CharThumb } from "@/features/char/components/CharThumb"
import { formatDurationMs } from "@/lib/formatDuration"
import type { ShareMetric } from "../lib/statsShare"
import {
	entityDetailHref,
	UsageEntityLeaderboardLabel,
	useUsageEntityName,
} from "./UsageEntityRow"

export type { ShareMetric }

type UsageLeaderboardRowProps = {
	readonly rank: number
	readonly total: UsageTotal
	readonly metric: ShareMetric
	readonly denominator: number
	readonly exposureMode: UsageExposureMode
	readonly variant?: "default" | "compact"
}

/** Kind glyphs for non-character rows — characters carry their avatar. */
const KIND_ICONS: Partial<Record<UsageEntityType, typeof Gallery>> = {
	resource: Gallery,
	document: DocumentText,
	plugin: PlugCircle,
}

function metricValue(metric: ShareMetric, total: UsageTotal): number {
	if (metric === "time") {
		return total.totalMs
	}
	return total.viewCount
}

function metricLabel(
	metric: ShareMetric,
	total: UsageTotal,
	exposureMode: UsageExposureMode,
	t: ReturnType<typeof useTranslation>["t"],
): string {
	if (metric === "time") {
		return formatDurationMs(total.totalMs)
	}
	if (exposureMode === "associated") {
		return t("usage.leaderboard.associatedSessionsShort", {
			count: total.viewCount,
		})
	}
	return t("usage.leaderboard.viewsShort", { count: total.viewCount })
}

export function UsageLeaderboardRow(props: UsageLeaderboardRowProps) {
	const {
		rank,
		total,
		metric,
		denominator,
		exposureMode,
		variant = "default",
	} = props
	const { t } = useTranslation()
	const { name } = useUsageEntityName(total.entityType, total.entityId)
	const href = entityDetailHref(total.entityType, total.entityId)
	const value = metricValue(metric, total)
	const sharePct =
		denominator > 0 ? Math.round((value / denominator) * 1000) / 10 : 0
	const barWidth =
		denominator > 0 ? Math.max(2, Math.round((value / denominator) * 100)) : 0
	const KindIcon = KIND_ICONS[total.entityType]

	const content =
		variant === "compact" ? (
			<div className="flex min-w-0 items-center gap-3 px-3 py-2">
				<span
					className={cn(
						"w-6 shrink-0 text-right text-sm tabular-nums text-muted-foreground",
						rank <= 3 && "font-semibold text-foreground",
					)}
				>
					{rank}
				</span>
				<div className="min-w-0 flex-1 truncate text-sm">
					<UsageEntityLeaderboardLabel
						entityType={total.entityType}
						entityId={total.entityId}
					/>
				</div>
				<span className="shrink-0 text-sm tabular-nums text-muted-foreground">
					{metricLabel(metric, total, exposureMode, t)}
				</span>
			</div>
		) : (
			/* Ranked share row: rank, leading visual (a
			    character's round avatar, other kinds a quiet icon), name,
			    flexible bar, right-aligned muted share/value metadata. Rows
			    are separated by whitespace, not hairlines. */
			<div className="flex h-12 items-center gap-4">
				<span
					className={cn(
						"w-6 shrink-0 text-right text-ui tabular-nums text-muted-foreground",
						rank <= 3 && "font-semibold text-foreground",
					)}
				>
					{rank}
				</span>
				<span className="flex w-56 min-w-0 shrink-0 items-center gap-2.5">
					{total.entityType === "character" ? (
						<span className="size-5 shrink-0 overflow-hidden rounded-full">
							<CharThumb
								charId={total.entityId}
								variant="avatar"
								cacheKey={total.updatedAt}
								name={name}
								className="h-full w-full"
								hoverOverlay={false}
							/>
						</span>
					) : KindIcon !== undefined ? (
						<span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
							<KindIcon className="size-4" />
						</span>
					) : null}
					<span className="min-w-0 truncate text-ui font-medium text-foreground">
						{name ?? total.entityId}
					</span>
				</span>
				<div className="flex-1">
					<div className="h-1 w-full overflow-hidden rounded-full bg-muted">
						<div
							className="h-full rounded-full bg-foreground/70"
							style={{ width: `${barWidth}%` }}
						/>
					</div>
				</div>
				<span className="w-28 shrink-0 text-right text-tiny tabular-nums text-muted-foreground">
					{sharePct}% · {metricLabel(metric, total, exposureMode, t)}
				</span>
			</div>
		)

	if (href !== undefined) {
		return (
			<Link to={href} className="block transition-colors hover:bg-accent/50">
				{content}
			</Link>
		)
	}

	return <div>{content}</div>
}
