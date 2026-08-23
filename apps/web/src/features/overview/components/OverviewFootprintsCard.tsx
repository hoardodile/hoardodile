import { Icon } from "@hoardodile/ui/components/icon"
import { SortByTime } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { useRelativeTime } from "@/features/overview/hooks/useRelativeTime"
import { traceTimelineQueryOptions } from "@/features/trace/api"
import {
	type TraceEvent,
	traceEventIcon,
	traceEventLabelKey,
} from "@/features/trace/lib/actionMeta"
import { loose } from "@/i18n"
import { OverviewRailCard, RailRowSkeleton } from "./OverviewRailCard"

const FOOTPRINT_PREVIEW_LIMIT = 3

function FootprintsEmptyState() {
	const { t } = useTranslation()
	return (
		<div className="flex w-full flex-col gap-2 py-2">
			<p className="text-[13px] text-muted-foreground">
				{t("overview.footprints.emptyPrompt")}
			</p>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
				<Link
					to="/resources/new"
					className="text-primary hover:underline"
					data-testid="overview-footprints-upload"
				>
					{t("overview.footprints.uploadResource")}
				</Link>
				<Link
					to="/resources/import"
					className="text-primary hover:underline"
					data-testid="overview-footprints-import"
				>
					{t("overview.footprints.importFolder")}
				</Link>
			</div>
		</div>
	)
}

/**
 * Hero footprints block: a small titled list of the most recent user
 * actions (kind icon, truncated sentence, relative time), each row linking
 * to the entity's own page, with "View all" at the header's right. Shares
 * the {@link OverviewRailCard} shell with the usage-history card; empty
 * state keeps the header and offers upload/import actions.
 */
export function OverviewFootprintsCard() {
	const { t } = useTranslation()
	const relativeTime = useRelativeTime()
	const timelineQuery = useQuery(
		traceTimelineQueryOptions({ limit: FOOTPRINT_PREVIEW_LIMIT }),
	)
	const events = (timelineQuery.data?.rows ?? []).slice(
		0,
		FOOTPRINT_PREVIEW_LIMIT,
	)

	return (
		<OverviewRailCard
			icon={<Icon icon={SortByTime} className="text-secondary-foreground" />}
			title={t("overview.footprints.title")}
			description={t("overview.footprints.description")}
			viewAll={
				<Link
					to="/footprints"
					className="text-xs text-muted-foreground transition-colors hover:text-secondary-foreground"
				>
					{t("overview.viewAll")}
				</Link>
			}
			data-testid="overview-footprints-card"
			rows={
				timelineQuery.isPending ? (
					Array.from({ length: FOOTPRINT_PREVIEW_LIMIT }).map((_, i) => (
						<RailRowSkeleton key={i} />
					))
				) : events.length === 0 ? (
					<FootprintsEmptyState />
				) : (
					events.map((event) => (
						<FootprintRow
							key={event.id}
							event={event}
							relativeTime={relativeTime}
						/>
					))
				)
			}
		/>
	)
}

function FootprintRow(props: {
	readonly event: TraceEvent
	readonly relativeTime: (ts: number) => string
}) {
	const { event, relativeTime } = props
	const { t } = useTranslation()
	const Icon = traceEventIcon(event.action, event.detail?.kind)
	const label = loose(t)(traceEventLabelKey(event.action, event.detail?.kind), {
		name: event.entityName,
	})
	const time = relativeTime(event.createdAt)
	const testId = `overview-footprint-${event.id}`

	// Only the icon + label are clickable: the link hugs its content while
	// the relative time sits right-aligned at the row's edge — the empty
	// row space neither reacts nor shows a pointer.
	const row = (clickable: ReactNode) => (
		<div className="flex h-7 w-full items-center gap-2">
			{clickable}
			<span className="ml-auto shrink-0 text-tiny text-muted-foreground">
				{time}
			</span>
		</div>
	)
	const linkContent = (
		<>
			<Icon className="size-4 shrink-0 text-muted-foreground" />
			<span className="min-w-0 truncate text-ui text-foreground group-hover:underline">
				{label}
			</span>
		</>
	)

	// Rows link to the entity's own page, like the footprints route — only
	// the header's "View all" goes to /footprints.
	if (event.entityType === "resource") {
		return row(
			<Link
				to="/resources/$id"
				params={{ id: event.entityId }}
				className="group flex min-w-0 items-center gap-2"
				data-testid={testId}
			>
				{linkContent}
			</Link>,
		)
	}
	if (event.entityType === "document") {
		return row(
			<Link
				to="/documents/$id"
				params={{ id: event.entityId }}
				className="group flex min-w-0 items-center gap-2"
				data-testid={testId}
			>
				{linkContent}
			</Link>,
		)
	}
	if (event.entityType === "character") {
		return row(
			<Link
				to="/characters/$id"
				params={{ id: event.entityId }}
				className="group flex min-w-0 items-center gap-2"
				data-testid={testId}
			>
				{linkContent}
			</Link>,
		)
	}
	return row(
		<div className="flex min-w-0 items-center gap-2" data-testid={testId}>
			{linkContent}
		</div>,
	)
}
