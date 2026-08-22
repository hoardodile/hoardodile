import type { Comment } from "@hoardodile/schemas"
import { ChatSquare } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { commentListQueryOptions } from "@/features/comments/api"
import {
	ActivityRowContent,
	ActivityRowSkeleton,
	activityRowClassName,
} from "../components/ActivityRows"
import { StatCard } from "../components/StatCard"
import { useRelativeTime } from "../hooks/useRelativeTime"

const COMMENT_SNIPPET_LENGTH = 120
const RECENT_COMMENTS_SIZE = 5

type RecentCommentsSectionProps = {
	readonly mode: "summary" | "list"
}

/**
 * How many messages the recent-comments tab currently displays, fetched
 * through the tab's own query options so both share one cache entry.
 */
export function useRecentCommentsCount(): number | undefined {
	const { data } = useQuery(
		commentListQueryOptions({
			page: 1,
			size: RECENT_COMMENTS_SIZE,
			sortBy: "newest",
			trashed: false,
		}),
	)
	return data?.rows.length
}

export function RecentCommentsSection(props: RecentCommentsSectionProps) {
	const { t } = useTranslation()

	const { data, isPending } = useQuery(
		commentListQueryOptions({
			page: 1,
			size: RECENT_COMMENTS_SIZE,
			sortBy: "newest",
			trashed: false,
		}),
	)

	if (props.mode === "summary") {
		return (
			<StatCard
				to="/messages"
				icon={ChatSquare}
				count={data?.totalAll ?? data?.total ?? 0}
				label={t("overview.stats.messages")}
				testId="overview-stat-comments"
				variant="plain"
			/>
		)
	}

	const listContent = isPending ? (
		<div className="flex flex-col">
			{Array.from({ length: RECENT_COMMENTS_SIZE }).map((_, i) => (
				<ActivityRowSkeleton key={i} />
			))}
		</div>
	) : data === undefined || data.rows.length === 0 ? (
		<p className="text-[13px] text-muted-foreground">
			{t("overview.empty.messages")}
		</p>
	) : (
		<div className="flex flex-col">
			{data.rows.map((comment) => (
				<CommentRow key={comment.id} comment={comment} />
			))}
		</div>
	)

	return <div data-testid="overview-activity-comments">{listContent}</div>
}

function CommentRow(props: { readonly comment: Comment }) {
	const { comment } = props
	const { t } = useTranslation()
	const relativeTime = useRelativeTime()
	const snippet =
		comment.body.length > COMMENT_SNIPPET_LENGTH
			? `${comment.body.slice(0, COMMENT_SNIPPET_LENGTH)}…`
			: comment.body

	const search =
		comment.charIds.length > 0
			? { charId: comment.charIds[0] }
			: comment.resIds.length > 0
				? { resId: comment.resIds[0] }
				: undefined

	return (
		<Link
			to="/messages"
			search={search}
			className={activityRowClassName}
			data-testid={`overview-comment-${comment.id}`}
		>
			<ActivityRowContent
				icon={ChatSquare}
				title={snippet}
				timeLabel={t("overview.activity.updated", {
					time: relativeTime(comment.createdAt),
				})}
			/>
		</Link>
	)
}
