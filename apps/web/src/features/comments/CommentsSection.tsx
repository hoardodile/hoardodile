import { SectionHeader } from "@hoardodile/ui/components/section-header"
import { ChatRound } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { commentListQueryOptions } from "./api"
import { CommentComposer } from "./CommentComposer"
import type { CommentItemProps } from "./CommentItem"
import { CommentList } from "./CommentList"
import { commentCountLabel } from "./commentCountLabel"
import { COMMENT_PAGE_SIZE } from "./searchState"

export type CommentsSectionProps = {
	readonly variant: "embedded"
	readonly context: NonNullable<CommentItemProps["context"]>
	readonly children?: ReactNode
	readonly testId?: string
}

export function CommentsSection(props: CommentsSectionProps) {
	const { context, testId } = props
	const [page, setPage] = useState(1)

	const charId = context.kind === "char" ? context.id : ""
	const resId = context.kind === "res" ? context.id : ""

	return (
		<section className="flex flex-col gap-4" data-testid={testId}>
			<CommentCountHeader charId={charId} resId={resId} />
			<CommentComposer
				variant="embedded"
				initialCharacterIds={context.kind === "char" ? [context.id] : undefined}
				initialResourceIds={context.kind === "res" ? [context.id] : undefined}
				lockInitialCharacterLinks={context.kind === "char"}
				lockInitialResourceLinks={context.kind === "res"}
			/>
			<CommentList
				input={{
					charId,
					resId,
					page,
					size: COMMENT_PAGE_SIZE,
					sortBy: "newest",
					trash: false,
				}}
				context={context}
				showPagination
				onPageChange={setPage}
				testId={testId !== undefined ? `${testId}-list` : undefined}
			/>
			{props.children}
		</section>
	)
}

/** The messages header: icon + title with the thread/reply count on the
    section header's baseline. */
function CommentCountHeader(props: {
	readonly charId: string
	readonly resId: string
}) {
	const { charId, resId } = props
	const { t } = useTranslation()
	const listQuery = useQuery(
		commentListQueryOptions({
			charId: charId !== "" ? charId : undefined,
			resId: resId !== "" ? resId : undefined,
			page: 1,
			size: 1,
			sortBy: "newest",
			trashed: false,
		}),
	)
	const count =
		listQuery.data === undefined
			? undefined
			: (() => {
					const total = listQuery.data.total
					const totalAll = listQuery.data.totalAll ?? total
					const label = commentCountLabel(total, totalAll - total, t)
					return label.length === 0 ? undefined : label
				})()
	return (
		<SectionHeader icon={ChatRound} title={t("messages.title")} count={count} />
	)
}
