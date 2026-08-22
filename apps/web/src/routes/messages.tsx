import { PageScaffold } from "@hoardodile/ui/components/page-scaffold"
import { useQuery } from "@tanstack/react-query"
import { createFileRoute } from "@tanstack/react-router"
import { commentListQueryOptions } from "@/features/comments"
import { CommentComposer } from "@/features/comments/CommentComposer"
import { CommentFilterBar } from "@/features/comments/CommentFilterBar"
import { CommentList } from "@/features/comments/CommentList"
import {
	COMMENT_SEARCH_DEFAULTS,
	commentSearchUrlSchema,
} from "@/features/comments/searchState"
import { useRouteSearchState } from "@/hooks/useRouteSearchState"
import { requireAuth } from "@/lib/auth-guard"

export const Route = createFileRoute("/messages")({
	beforeLoad: requireAuth,
	validateSearch: commentSearchUrlSchema,
	component: CommentsPage,
})

function CommentsPage() {
	const [searchState, patch] = useRouteSearchState(COMMENT_SEARCH_DEFAULTS)

	const charId = searchState.charId
	const resId = searchState.resId
	const trash = searchState.trash

	// The floors/replies count lives in the filter-chips row
	// (right-aligned metadata count), fetched at size 1 since totals are
	// page-independent.
	const totalsQuery = useQuery(
		commentListQueryOptions({
			query: searchState.query !== "" ? searchState.query : undefined,
			charId: charId !== "" ? charId : undefined,
			resId: resId !== "" ? resId : undefined,
			sortBy: searchState.sortBy,
			trashed: trash,
			page: 1,
			size: 1,
		}),
	)
	const totals = totalsQuery.data
	const count =
		totals === undefined
			? undefined
			: {
					floors: totals.total,
					replies: (totals.totalAll ?? totals.total) - totals.total,
				}

	return (
		<PageScaffold width="reading">
			{/* Design MessagesPage rhythm: filter → composer → threads and
			    threads → pagination all at 16px; the pager itself sits 32px
			    below the last thread (CommentList). */}
			<div className="flex flex-col gap-4">
				<CommentFilterBar state={searchState} patch={patch} count={count} />

				{!trash ? (
					<CommentComposer
						variant="standalone"
						initialCharacterIds={charId !== "" ? [charId] : undefined}
						initialResourceIds={resId !== "" ? [resId] : undefined}
					/>
				) : null}

				<CommentList
					input={{
						charId,
						resId,
						query: searchState.query,
						sortBy: searchState.sortBy,
						trash,
						page: searchState.page,
						size: searchState.size,
					}}
					showPagination
					onPageChange={(page) => patch({ page }, { push: true })}
				/>
			</div>
		</PageScaffold>
	)
}
