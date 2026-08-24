import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import { PaginationBar } from "@hoardodile/ui/components/pagination-bar"
import { SectionHeader } from "@hoardodile/ui/components/section-header"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import { SortByTime } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	dayLabel,
	groupByTimestamp,
	TimelineDayCards,
} from "@/components/common/TimelineDayCards"
import { CharThumb } from "@/features/char/components/CharThumb"
import { useRelativeTime } from "@/features/overview/hooks/useRelativeTime"
import { useUsageTimeZones } from "@/features/settings/datePrefs"
import { useUsageEntityCharacter } from "@/features/usage/components/UsageEntityRow"
import type { UsagePlatformFilterValue } from "@/features/usage/components/UsagePlatformFilter"
import { usagePlatformFilterParam } from "@/features/usage/components/UsagePlatformFilter"
import { loose } from "@/i18n"
import { type TraceTimelineInput, traceTimelineQueryOptions } from "../api"
import {
	TRACE_ENTITY_GROUPS,
	type TraceEntityType,
	type TraceEvent,
	traceEventIcon,
	traceEventLabelKey,
} from "../lib/actionMeta"
import { TraceOverviewSection } from "./TraceOverviewSection"

const PAGE_SIZE = 20

type TraceTimelinePageProps = {
	readonly platform: UsagePlatformFilterValue
}

export function TraceTimelinePage(props: TraceTimelinePageProps) {
	const { platform } = props
	const { t } = useTranslation()
	const { resolvedTimeZone } = useUsageTimeZones()
	const relativeTime = useRelativeTime()
	const [filter, setFilter] = useState<TraceEntityType | "all">("all")
	const [page, setPage] = useState(1)

	const input: TraceTimelineInput = useMemo(() => {
		const next: TraceTimelineInput = { limit: PAGE_SIZE, page }
		if (filter !== "all") next.entityType = filter
		const platformFilter = usagePlatformFilterParam(platform)
		if (platformFilter !== undefined) next.platform = platformFilter
		return next
	}, [filter, platform, page])

	const timelineQuery = useQuery(traceTimelineQueryOptions(input))

	function selectFilter(next: TraceEntityType | "all"): void {
		setFilter(next)
		setPage(1)
	}

	const rows = timelineQuery.data?.rows ?? []
	const groups = useMemo(
		() => groupByTimestamp(rows, (event) => event.createdAt, resolvedTimeZone),
		[rows, resolvedTimeZone],
	)
	const loading = timelineQuery.isLoading && rows.length === 0
	const total = timelineQuery.data?.total ?? 0
	const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE))

	return (
		<div className="flex flex-col" data-testid="trace-page">
			<TraceOverviewSection platform={platform} />

			<div className="mt-8">
				<SectionHeader
					icon={SortByTime}
					title={t("trace.timelineTitle")}
					right={
						timelineQuery.data !== undefined ? (
							<span className="text-xs text-muted-foreground">
								{t("trace.count", { count: timelineQuery.data.total })}
							</span>
						) : undefined
					}
				/>

				<SectionTabs
					value={filter}
					onChange={(value) => selectFilter(value as TraceEntityType | "all")}
					className="mt-4"
					items={[
						{ value: "all", label: t("trace.filterAll") },
						...TRACE_ENTITY_GROUPS.map((group) => ({
							value: group.value,
							label: loose(t)(group.labelKey),
							testId: `trace-filter-${group.value}`,
						})),
					]}
				/>

				{loading ? (
					<p className="py-8 text-center text-sm text-muted-foreground">
						{t("trace.loading")}
					</p>
				) : groups.length === 0 ? (
					<p className="py-8 text-center text-sm text-muted-foreground">
						{t("trace.empty")}
					</p>
				) : (
					<div className="mt-6">
						<TimelineDayCards
							groups={groups}
							dayLabel={(day) =>
								dayLabel(
									day,
									resolvedTimeZone,
									loose(t),
									"trace.today",
									"trace.yesterday",
								)
							}
							dayTestId={(day) => `trace-day-${day}`}
						>
							{(group) =>
								group.items.map((event) => (
									<TraceEventRow
										key={event.id}
										event={event}
										relativeTime={relativeTime}
									/>
								))
							}
						</TimelineDayCards>
					</div>
				)}

				{timelineQuery.isError ? (
					<p className="py-4 text-center text-xs text-destructive">
						{t("trace.loadError")}
					</p>
				) : null}

				{pageCount > 1 && timelineQuery.data !== undefined ? (
					<div className="mt-4">
						<PaginationBar
							page={page}
							pageCount={pageCount}
							totalLabel={t("trace.count", { count: total })}
							onChangePage={setPage}
						/>
					</div>
				) : null}
			</div>
		</div>
	)
}

function TraceEventRow(props: {
	readonly event: TraceEvent
	readonly relativeTime: (ts: number) => string
}) {
	const { event, relativeTime } = props
	const { t } = useTranslation()
	const kind = event.detail?.kind
	const Icon = traceEventIcon(event.action, kind)
	const characterQuery = useUsageEntityCharacter(
		event.entityId,
		event.entityType === "character",
	)

	const detailParts: string[] = []
	if (
		event.detail?.sourceName !== undefined &&
		event.detail?.sourceName !== null
	) {
		detailParts.push(t("trace.meta.source", { name: event.detail.sourceName }))
	}
	if (event.detail?.fileCount !== undefined) {
		detailParts.push(
			t("trace.meta.fileCount", { count: event.detail.fileCount }),
		)
	}
	const detailText =
		detailParts.length > 0 ? `${detailParts.join(" Â· ")} Â· ` : ""

	const content = (
		<>
			{event.entityType === "character" && characterQuery.data !== undefined ? (
				<CharThumb
					charId={event.entityId}
					variant="avatar"
					cacheKey={characterQuery.data.updatedAt}
					name={characterQuery.data.name}
					className="size-4 shrink-0 rounded-full"
					hoverOverlay={false}
				/>
			) : (
				<Icon className="size-4 shrink-0 text-muted-foreground" />
			)}
			<span className="min-w-0 flex-1 truncate text-ui text-foreground">
				{loose(t)(traceEventLabelKey(event.action, kind), {
					name: event.entityName,
				})}
			</span>
			{event.detail?.bulk === true ? (
				<MetaChip>{t("trace.meta.bulk")}</MetaChip>
			) : null}
			<span className="shrink-0 text-xs text-muted-foreground">
				{detailText}
				{relativeTime(event.createdAt)}
			</span>
		</>
	)

	const className =
		"flex h-nav items-center gap-3 rounded-lg px-2 hover:bg-muted"
	const testId = `trace-row-${event.id}`
	if (event.entityType === "resource") {
		return (
			<Link
				to="/resources/$id"
				params={{ id: event.entityId }}
				className={className}
				data-testid={testId}
			>
				{content}
			</Link>
		)
	}
	if (event.entityType === "document") {
		return (
			<Link
				to="/documents/$id"
				params={{ id: event.entityId }}
				className={className}
				data-testid={testId}
			>
				{content}
			</Link>
		)
	}
	if (event.entityType === "character") {
		return (
			<Link
				to="/characters/$id"
				params={{ id: event.entityId }}
				className={className}
				data-testid={testId}
			>
				{content}
			</Link>
		)
	}
	return (
		<div className={className} data-testid={testId}>
			{content}
		</div>
	)
}
