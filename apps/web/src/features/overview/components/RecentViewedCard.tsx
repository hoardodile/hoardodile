import type { UsageEntityType, UsageTotal } from "@hoardodile/schemas"
import { Icon } from "@hoardodile/ui/components/icon"
import {
	ClockCircle,
	DocumentText,
	Gallery,
} from "@hoardodile/ui/icons/registry"
import { Link } from "@tanstack/react-router"
import { memo } from "react"
import { useTranslation } from "react-i18next"
import { CharThumb } from "@/features/char/components/CharThumb"
import {
	entityDetailHref,
	useUsageEntityName,
} from "@/features/usage/components/UsageEntityRow"
import { useRecentViewedTotals } from "../hooks/useRecentViewedTotals"
import { useRelativeTime } from "../hooks/useRelativeTime"
import { OverviewRailCard, RailRowSkeleton } from "./OverviewRailCard"

const RECENT_VIEWED_PREVIEW_LIMIT = 3

function entityTypeIcon(entityType: UsageEntityType) {
	switch (entityType) {
		case "resource":
			return Gallery
		default:
			return DocumentText
	}
}

const RecentViewedCardItemMedia = memo(
	function RecentViewedCardItemMedia(props: {
		readonly item: UsageTotal
		readonly name: string | undefined
	}) {
		if (props.item.entityType === "character") {
			return (
				<CharThumb
					charId={props.item.entityId}
					variant="avatar"
					cacheKey={props.item.updatedAt}
					name={props.name}
					className="size-4 shrink-0 rounded-full"
					hoverOverlay={false}
				/>
			)
		}

		const Icon = entityTypeIcon(props.item.entityType)
		return <Icon className="size-4 shrink-0 text-muted-foreground" />
	},
)

const RecentViewedCardItem = memo(function RecentViewedCardItem(props: {
	readonly item: UsageTotal
	readonly testId?: string
}) {
	const { t } = useTranslation()
	const relativeTime = useRelativeTime()
	const { name, isPending: isNamePending } = useUsageEntityName(
		props.item.entityType,
		props.item.entityId,
	)
	const href = entityDetailHref(props.item.entityType, props.item.entityId)
	const viewedAt =
		props.item.lastViewedAt !== null
			? relativeTime(props.item.lastViewedAt)
			: t("overview.recentViewed.unknownTime")

	// Only the icon + label are clickable: the link hugs its content while
	// the viewed-at time sits right-aligned at the row's edge — the empty
	// row space neither reacts nor shows a pointer.
	const content = (
		<>
			<RecentViewedCardItemMedia item={props.item} name={name} />
			<span className="min-w-0 truncate text-ui text-foreground group-hover:underline">
				{name ?? props.item.entityId}
			</span>
		</>
	)
	const time = (
		<span className="ml-auto shrink-0 text-tiny text-muted-foreground">
			{viewedAt}
		</span>
	)

	if (isNamePending) {
		return (
			<div data-testid={props.testId}>
				<RailRowSkeleton />
			</div>
		)
	}

	if (href === undefined) {
		return (
			<div
				className="flex h-7 w-full items-center gap-2"
				data-testid={props.testId}
			>
				<div className="flex min-w-0 items-center gap-2">{content}</div>
				{time}
			</div>
		)
	}

	return (
		<div className="flex h-7 w-full items-center gap-2">
			<Link
				to={href}
				className="group flex min-w-0 items-center gap-2"
				data-testid={props.testId}
			>
				{content}
			</Link>
			{time}
		</div>
	)
})

function RecentViewedEmptyState() {
	const { t } = useTranslation()
	return (
		<div className="flex w-full flex-col gap-2 py-2">
			<p className="text-[13px] text-muted-foreground">
				{t("overview.recentViewed.emptyPrompt")}
			</p>
			<div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-[13px]">
				<Link
					to="/resources"
					className="text-primary hover:underline"
					data-testid="overview-recent-viewed-browse"
				>
					{t("overview.recentViewed.browseResources")}
				</Link>
				<Link
					to="/resources/new"
					className="text-primary hover:underline"
					data-testid="overview-recent-viewed-upload"
				>
					{t("overview.recentViewed.uploadResource")}
				</Link>
			</div>
		</div>
	)
}

/**
 * Usage-history card hanging at the hero's top-right, sharing the
 * {@link OverviewRailCard} shell with the footprints card: titled vertical
 * list of the most recently used entities, "View all" linking to the full
 * usage history page.
 */
export function RecentViewedCard() {
	const { t } = useTranslation()
	const { items, isPending } = useRecentViewedTotals()

	const previewItems = items.slice(0, RECENT_VIEWED_PREVIEW_LIMIT)

	return (
		<OverviewRailCard
			icon={<Icon icon={ClockCircle} className="text-secondary-foreground" />}
			title={t("overview.usageHistory.title")}
			description={t("overview.recentViewed.description")}
			viewAll={
				<Link
					to="/usage"
					className="text-xs text-muted-foreground transition-colors hover:text-secondary-foreground"
					data-testid="overview-recent-viewed-view-all"
				>
					{t("overview.viewAll")}
				</Link>
			}
			data-testid="overview-recent-viewed-block"
			rows={
				isPending ? (
					Array.from({ length: RECENT_VIEWED_PREVIEW_LIMIT }).map((_, i) => (
						<RailRowSkeleton key={i} />
					))
				) : previewItems.length === 0 ? (
					<RecentViewedEmptyState />
				) : (
					previewItems.map((item, index) => (
						<RecentViewedCardItem
							key={`${item.entityType}:${item.entityId}`}
							item={item}
							testId={`overview-recent-viewed-item-${index}`}
						/>
					))
				)
			}
		/>
	)
}
