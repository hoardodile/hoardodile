import type { DocNode } from "@hoardodile/schemas"
import type { SortBy } from "@hoardodile/shared"
import { DocumentText } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useMemo } from "react"
import { useTranslation } from "react-i18next"
import { docTreeQueryOptions } from "@/features/doc/api"
import {
	ActivityRowContent,
	ActivityRowSkeleton,
	activityRowClassName,
} from "../components/ActivityRows"
import { StatCard } from "../components/StatCard"
import { useRelativeTime } from "../hooks/useRelativeTime"

const RECENT_DOCUMENTS_SIZE = 5

type RecentDocumentsSectionProps = {
	readonly mode: "summary" | "list"
	/** Sort for the list mode — owned by the section header's pill tabs. */
	readonly sortBy?: SortBy
}

/**
 * How many documents the recent-documents tab currently displays — the
 * sorted recent list, fetched through the tab's own query options so both
 * share one cache entry.
 */
export function useRecentDocumentsCount(sortBy: SortBy): number | undefined {
	const { data } = useQuery(docTreeQueryOptions())
	if (data === undefined) return undefined
	return getRecentDocuments(data, sortBy).length
}

export function RecentDocumentsSection(props: RecentDocumentsSectionProps) {
	const { t } = useTranslation()
	const relativeTime = useRelativeTime()
	const sortBy = props.sortBy ?? "updated"

	const { data, isPending } = useQuery(docTreeQueryOptions())

	const documents = useMemo(
		() => getRecentDocuments(data, sortBy),
		[data, sortBy],
	)

	if (props.mode === "summary") {
		return (
			<StatCard
				to="/documents"
				icon={DocumentText}
				count={data?.length ?? 0}
				label={t("overview.stats.documents")}
				testId="overview-stat-documents"
				variant="plain"
			/>
		)
	}

	const listContent = isPending ? (
		<div className="flex flex-col">
			{Array.from({ length: RECENT_DOCUMENTS_SIZE }).map((_, i) => (
				<ActivityRowSkeleton key={i} />
			))}
		</div>
	) : documents.length === 0 ? (
		<p className="text-[13px] text-muted-foreground">
			{t("overview.empty.documents")}
		</p>
	) : (
		<div className="flex flex-col">
			{documents.map((doc) => (
				<Link
					key={doc.id}
					to="/documents/$id"
					params={{ id: doc.id }}
					className={activityRowClassName}
					data-testid={`overview-doc-${doc.id}`}
				>
					<ActivityRowContent
						icon={DocumentText}
						title={doc.title}
						timeLabel={t("overview.activity.updated", {
							time: relativeTime(
								sortBy === "created" ? doc.createdAt : doc.updatedAt,
							),
						})}
					/>
				</Link>
			))}
		</div>
	)

	return <div data-testid="overview-activity-documents">{listContent}</div>
}

function getRecentDocuments(
	nodes: readonly DocNode[] | undefined,
	sortBy: SortBy,
): DocNode[] {
	if (nodes === undefined) return []
	return [...nodes]
		.filter((node) => node.kind === "document")
		.sort((a, b) => {
			const field = sortBy === "created" ? "createdAt" : "updatedAt"
			return b[field] - a[field]
		})
		.slice(0, RECENT_DOCUMENTS_SIZE)
}
