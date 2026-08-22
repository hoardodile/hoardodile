import type { Comment } from "@hoardodile/schemas"
import { ListEmptyRow } from "@hoardodile/ui/components/list-empty-row"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Surface } from "@hoardodile/ui/components/surface"
import { pageCountOf } from "@hoardodile/ui/lib/pagination"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { PaginationBar } from "@/components/common/PaginationBar"
import { commentListQueryOptions } from "./api"
import { CommentItem, type CommentItemProps } from "./CommentItem"
import type { CommentSearchState } from "./searchState"

export type CommentListInput = {
	readonly charId?: string
	readonly resId?: string
	readonly query?: string
	readonly sortBy?: CommentSearchState["sortBy"]
	readonly trash?: boolean
	readonly page?: number
	readonly size?: number
}

export type CommentListProps = {
	readonly input: CommentListInput
	readonly context?: CommentItemProps["context"]
	readonly showPagination?: boolean
	readonly onPageChange?: (page: number) => void
	readonly testId?: string
}

export function CommentList(props: CommentListProps) {
	const {
		input,
		context,
		showPagination = false,
		onPageChange,
		testId = "comment-list",
	} = props
	const { t } = useTranslation()
	const listRef = useRef<HTMLDivElement>(null)
	const page = input.page ?? 1
	const size = input.size ?? 20

	const trash = input.trash ?? false

	const listQuery = useQuery({
		...commentListQueryOptions({
			query: input.query !== "" ? input.query : undefined,
			page,
			size,
			charId: input.charId !== "" ? input.charId : undefined,
			resId: input.resId !== "" ? input.resId : undefined,
			sortBy: input.sortBy ?? "newest",
			trashed: trash,
		}),
		placeholderData: keepPreviousData,
	})

	const rows = listQuery.data?.rows ?? []
	const total = listQuery.data?.total ?? 0
	const pageCount = pageCountOf(total, size)

	useEffect(() => {
		if (listQuery.isPlaceholderData) return
		if (rows.length === 0 && total > 0) {
			const target = Math.max(1, page - 1)
			if (target !== page) {
				onPageChange?.(target)
			}
		}
	}, [listQuery.isPlaceholderData, page, rows.length, total, onPageChange])

	function handlePageChange(nextPage: number) {
		onPageChange?.(nextPage)
		listRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })
	}

	if (listQuery.isPending && listQuery.data === undefined) {
		return (
			<div className="flex flex-col gap-5" data-testid={`${testId}-loading`}>
				<CommentCardSkeleton />
				<CommentCardSkeleton />
				<CommentCardSkeleton />
			</div>
		)
	}

	if (rows.length === 0) {
		return (
			<ListEmptyRow testId={`${testId}-empty`}>
				{trash ? t("messages.emptyTrash") : t("messages.empty")}
			</ListEmptyRow>
		)
	}

	const pager = showPagination && pageCount > 1 && onPageChange !== undefined

	return (
		<div ref={listRef} className="flex flex-col" data-testid={testId}>
			{pager && (
				<div className="mb-4">
					<PaginationBar
						page={page}
						pageCount={pageCount}
						onChangePage={handlePageChange}
						totalLabel={t("messages.totalLabel", { count: total })}
					/>
				</div>
			)}
			<div className="flex flex-col gap-4">
				{rows.map((row) => (
					<CommentItem
						key={row.id}
						comment={row}
						replies={row.floorContext?.replies}
						trash={trash}
						context={context}
					/>
				))}
			</div>
			{pager && (
				<div className="mt-6">
					<PaginationBar
						page={page}
						pageCount={pageCount}
						onChangePage={handlePageChange}
						totalLabel={t("messages.totalLabel", { count: total })}
					/>
				</div>
			)}
		</div>
	)
}

function CommentCardSkeleton() {
	return (
		<Surface size="default" className="flex flex-col gap-3 px-6 py-4">
			<Skeleton className="h-3 w-32" />
			<Skeleton className="h-4 w-full" />
			<Skeleton className="h-4 w-4/5" />
			<div className="flex gap-2">
				<Skeleton className="h-7 w-14" />
				<Skeleton className="h-7 w-14" />
				<Skeleton className="h-7 w-16" />
			</div>
		</Surface>
	)
}

export type { Comment }
