import type { UsageEntityType, UsageTotal } from "@hoardodile/schemas"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { DocumentText, Gallery, User } from "@hoardodile/ui/icons/registry"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { CharThumb } from "@/features/char/components/CharThumb"
import { useResolvedTimeZone } from "@/features/settings/datePrefs"
import {
	entityDetailHref,
	useUsageEntityCharacter,
	useUsageEntityName,
} from "@/features/usage/components/UsageEntityRow"
import { dayjsFor } from "@/lib/timezone"

type UsageHistoryRowProps = {
	readonly item: UsageTotal
	readonly testId?: string
}

function entityTypeIcon(entityType: UsageEntityType) {
	switch (entityType) {
		case "resource":
			return Gallery
		case "character":
			return User
		default:
			return DocumentText
	}
}

function entityTypeLabelKey(
	entityType: UsageEntityType,
):
	| "usage.leaderboard.entityResources"
	| "usage.leaderboard.entityCharacters"
	| "usage.leaderboard.entityDocuments" {
	if (entityType === "character") {
		return "usage.leaderboard.entityCharacters"
	}
	if (entityType === "document") {
		return "usage.leaderboard.entityDocuments"
	}
	return "usage.leaderboard.entityResources"
}

/**
 * Usage-history timeline row, mirroring the footprints page rows
 * (TraceEventRow): `h-nav` row, muted leading glyph, truncated
 * "type · name" label, and the time-of-day right-aligned. The day card
 * above carries the calendar context, so the row shows time only.
 * Character rows lead with the character's avatar while it still exists,
 * falling back to the generic icon after a hard delete.
 */
export function UsageHistoryRow(props: UsageHistoryRowProps) {
	const { item, testId } = props
	const { t } = useTranslation()
	const resolvedTimeZone = useResolvedTimeZone()
	const { name, isPending: isNamePending } = useUsageEntityName(
		item.entityType,
		item.entityId,
	)
	const characterQuery = useUsageEntityCharacter(
		item.entityId,
		item.entityType === "character",
	)
	const href = entityDetailHref(item.entityType, item.entityId)
	const Icon = entityTypeIcon(item.entityType)
	const typeLabel = t(entityTypeLabelKey(item.entityType))
	const displayName = name ?? item.entityId

	if (isNamePending) {
		return <Skeleton className="h-nav w-full" data-testid={testId} />
	}
	const time =
		item.lastViewedAt !== null
			? dayjsFor(item.lastViewedAt, resolvedTimeZone).format("HH:mm")
			: t("usage.history.unknownTime")

	const content = (
		<>
			{item.entityType === "character" && characterQuery.data !== undefined ? (
				<CharThumb
					charId={item.entityId}
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
				<span className="text-muted-foreground">{typeLabel}</span>
				<span aria-hidden> · </span>
				<span className="text-foreground">{displayName}</span>
			</span>
			<span className="shrink-0 text-xs text-muted-foreground tabular-nums">
				{time}
			</span>
		</>
	)

	const className =
		"flex h-nav items-center gap-3 rounded-lg px-2 hover:bg-muted"

	if (href === undefined) {
		return (
			<div className={className} data-testid={testId}>
				{content}
			</div>
		)
	}

	return (
		<Link to={href} className={className} data-testid={testId}>
			{content}
		</Link>
	)
}
