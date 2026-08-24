import type { Comment, CommentVote } from "@hoardodile/schemas"
import { Badge } from "@hoardodile/ui/components/badge"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { Icon } from "@hoardodile/ui/components/icon"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Surface } from "@hoardodile/ui/components/surface"
import {
	Dislike,
	Like,
	MenuDots as More,
	Restart,
	TrashBinMinimalistic,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { CharChipsPicker } from "@/features/char/components/CharChipsPicker"
import {
	addCommentVoteMutation,
	commentThreadQueryOptions,
	commentVotesQueryOptions,
	hardDeleteCommentMutation,
	invalidateComments,
	restoreCommentMutation,
	softDeleteCommentMutation,
} from "@/features/comments"
import { useDateFormatter } from "@/features/settings/datePrefs"
import { useToastMutation } from "@/hooks/useToastMutation"
import { ResChipsPicker } from "../res/components/ResChipsPicker"
import { CommentAnchorChip } from "./anchor"
import { CommentComposer } from "./CommentComposer"
import { MessageTextAction } from "./MessageTextAction"

export type CommentItemProps = {
	readonly comment: Comment
	readonly replies?: readonly Comment[]
	readonly depth?: number
	readonly trash?: boolean
	readonly hideActions?: boolean
	/** Per-thread reply number (replies count from #1 per floor). */
	readonly replyNumber?: number
	readonly context?:
		| { readonly kind: "char"; readonly id: string }
		| { readonly kind: "res"; readonly id: string }
}

export function CommentItem(props: CommentItemProps) {
	const {
		comment,
		replies,
		depth = 0,
		trash = false,
		hideActions = false,
		replyNumber,
		context,
	} = props
	const { t } = useTranslation()
	const formatter = useDateFormatter()
	const [replyOpen, setReplyOpen] = useState(false)
	const [showReplies, setShowReplies] = useState(true)
	const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false)
	const [hardDeleteConfirmOpen, setHardDeleteConfirmOpen] = useState(false)

	const isDeleted = comment.deletedAt !== undefined
	const effectiveHideActions = hideActions || (trash && !isDeleted)

	const threadQuery = useQuery({
		...commentThreadQueryOptions(comment.id, {}),
		enabled:
			replies === undefined && showReplies && comment.replyCount > 0 && !trash,
	})

	const effectiveReplies =
		replies ?? (threadQuery.data?.replies as readonly Comment[] | undefined)

	const votesQuery = useQuery({
		...commentVotesQueryOptions(comment.id),
		enabled: comment.likeCount + comment.dislikeCount > 0,
	})

	const addLikeMut = useToastMutation({
		...addCommentVoteMutation(),
		invalidate: (qc) => invalidateComments(qc),
		errorToastKey: "messages.toast.voteFailed",
	})
	const softDeleteMut = useToastMutation({
		...softDeleteCommentMutation(),
		invalidate: (qc) => invalidateComments(qc),
		successToastKey: "messages.toast.deleted",
		onSuccess: () => setDeleteConfirmOpen(false),
	})
	const restoreMut = useToastMutation({
		...restoreCommentMutation(),
		invalidate: (qc) => invalidateComments(qc),
		successToastKey: "messages.toast.restored",
	})
	const hardDeleteMut = useToastMutation({
		...hardDeleteCommentMutation(),
		invalidate: (qc) => invalidateComments(qc),
		successToastKey: "messages.toast.hardDeleted",
		onSuccess: () => setHardDeleteConfirmOpen(false),
	})

	function handleVote(kind: "like" | "dislike") {
		addLikeMut.mutate({ commentId: comment.id, kind })
	}

	const allVotes: readonly CommentVote[] = votesQuery.data ?? []
	const activeVote = allVotes.find((v) => v.cancellable)
	const isLikeActive = activeVote?.kind === "like"
	const isDislikeActive = activeVote?.kind === "dislike"

	const visibleCharIds =
		context?.kind === "char"
			? comment.charIds.filter((id) => id !== context.id)
			: comment.charIds
	const visibleResIds =
		context?.kind === "res"
			? comment.resIds.filter((id) => id !== context.id)
			: comment.resIds

	const hasMeta =
		visibleCharIds.length > 0 ||
		comment.anchor !== undefined ||
		visibleResIds.length > 0

	const actionsPending =
		softDeleteMut.isPending || restoreMut.isPending || hardDeleteMut.isPending

	const header = (
		<header className="flex items-baseline gap-2 text-tiny text-muted-foreground">
			{depth === 0 && comment.floor !== undefined ? (
				<span>{t("messages.floor", { n: comment.floor })}</span>
			) : replyNumber !== undefined ? (
				<span>{t("messages.replyNumber", { n: replyNumber })}</span>
			) : null}
			<time className="ml-auto">
				{formatter.formatDateTime(comment.createdAt)}
			</time>
			{isDeleted ? (
				<Badge variant="destructive" className="rounded-md">
					{t("messages.deleted")}
				</Badge>
			) : null}
		</header>
	)

	const footer = (
		<footer className="flex flex-wrap items-center gap-4">
			{!trash && !effectiveHideActions ? (
				<>
					<MessageTextAction
						onClick={() => handleVote("like")}
						disabled={addLikeMut.isPending}
						aria-pressed={isLikeActive}
						className={cn(isLikeActive && "text-primary hover:text-primary")}
					>
						<Icon icon={Like} mode={isLikeActive ? "bold" : "linear"} />
						<span className="text-tiny tabular-nums">{comment.likeCount}</span>
					</MessageTextAction>
					<MessageTextAction
						onClick={() => handleVote("dislike")}
						disabled={addLikeMut.isPending}
						aria-pressed={isDislikeActive}
						className={cn(isDislikeActive && "text-primary hover:text-primary")}
					>
						<Icon icon={Dislike} mode={isDislikeActive ? "bold" : "linear"} />
						<span className="text-tiny tabular-nums">
							{comment.dislikeCount}
						</span>
					</MessageTextAction>
					<MessageTextAction onClick={() => setReplyOpen((v) => !v)}>
						{t("messages.reply")}
					</MessageTextAction>
				</>
			) : null}
			{comment.replyCount > 0 && !trash && !effectiveHideActions ? (
				<MessageTextAction onClick={() => setShowReplies((v) => !v)}>
					{showReplies
						? t("messages.collapseReplies")
						: t("messages.viewReplies", { count: comment.replyCount })}
				</MessageTextAction>
			) : null}
			{!effectiveHideActions ? (
				<DropdownMenu modal={false}>
					<DropdownMenuTrigger
						render={
							<MessageTextAction
								className="ml-auto"
								aria-label={t("messages.actions")}
								disabled={actionsPending}
							>
								<Icon icon={More} />
							</MessageTextAction>
						}
					/>
					<DropdownMenuContent align="end" className="w-44">
						{trash ? (
							<>
								<DropdownMenuItem
									onClick={() => restoreMut.mutate({ id: comment.id })}
									disabled={restoreMut.isPending}
								>
									<Icon icon={Restart} />
									{t("messages.restore")}
								</DropdownMenuItem>
								<DropdownMenuSeparator />
								<DropdownMenuItem
									variant="destructive"
									onClick={() => setHardDeleteConfirmOpen(true)}
								>
									<Icon icon={TrashBinMinimalistic} />
									{t("messages.hardDelete")}
								</DropdownMenuItem>
							</>
						) : (
							<DropdownMenuItem
								variant="destructive"
								onClick={() => setDeleteConfirmOpen(true)}
							>
								<Icon icon={TrashBinMinimalistic} />
								{t("messages.delete")}
							</DropdownMenuItem>
						)}
					</DropdownMenuContent>
				</DropdownMenu>
			) : null}
		</footer>
	)

	const replyComposer =
		replyOpen && !trash ? (
			<div className="mt-3">
				<CommentComposer
					variant="reply"
					parentId={comment.id}
					initialCharacterIds={
						context?.kind === "char" ? [context.id] : undefined
					}
					initialResourceIds={
						context?.kind === "res" ? [context.id] : undefined
					}
					lockInitialCharacterLinks={context?.kind === "char"}
					lockInitialResourceLinks={context?.kind === "res"}
					onPosted={() => setReplyOpen(false)}
				/>
			</div>
		) : null

	const replySkeleton =
		showReplies &&
		comment.replyCount > 0 &&
		(replies === undefined || replies.length > 0) &&
		!trash &&
		threadQuery.isPending &&
		effectiveReplies === undefined ? (
			<div className="mt-4 flex flex-col gap-2 border-l-2 border-muted pl-5">
				<Skeleton className="h-20 rounded-lg" />
				<Skeleton className="h-20 rounded-lg" />
			</div>
		) : null

	const replyTree =
		showReplies &&
		effectiveReplies !== undefined &&
		effectiveReplies.length > 0 ? (
			<CommentReplyTree
				parentId={comment.id}
				all={effectiveReplies}
				depth={depth + 1}
				trash={trash}
				hideActions={trash ? false : hideActions}
				context={context}
			/>
		) : null

	const content = (
		<>
			{header}
			<p className="mt-2 whitespace-pre-wrap text-ui leading-[1.7]">
				{comment.body}
			</p>
			{hasMeta ? (
				<div className="mt-3 flex flex-wrap items-center gap-2">
					{visibleCharIds.length > 0 ? (
						<CharChipsPicker ids={visibleCharIds} />
					) : null}
					{comment.anchor !== undefined ? (
						<CommentAnchorChip
							anchor={comment.anchor}
							hideResourceName={
								context?.kind === "res" && context.id === comment.anchor.resId
							}
						/>
					) : null}
					{visibleResIds.length > 0 ? (
						<ResChipsPicker ids={visibleResIds} />
					) : null}
				</div>
			) : null}
			{!effectiveHideActions ? <div className="mt-3">{footer}</div> : null}
			{replyComposer}
			{replySkeleton}
			{replyTree}
		</>
	)

	const dialogs = (
		<>
			<ConfirmDialog
				open={deleteConfirmOpen}
				onOpenChange={setDeleteConfirmOpen}
				title={t("messages.deleteConfirmTitle")}
				description={t("messages.deleteConfirmDescription")}
				confirmLabel={t("messages.delete")}
				isPending={softDeleteMut.isPending}
				onConfirm={() => softDeleteMut.mutate({ id: comment.id })}
			/>
			<ConfirmDialog
				open={hardDeleteConfirmOpen}
				onOpenChange={setHardDeleteConfirmOpen}
				title={t("messages.hardDeleteConfirmTitle")}
				description={t("messages.hardDeleteConfirmDescription")}
				confirmLabel={t("messages.hardDelete")}
				isPending={hardDeleteMut.isPending}
				onConfirm={() => hardDeleteMut.mutate({ id: comment.id })}
			/>
		</>
	)

	// Replies render as plain indented blocks inside the parent floor's
	// card (MessageItem): 2px accent fill bar, no nested card.
	if (depth > 0) {
		return (
			<div
				className={cn(
					"mt-4 ml-1 border-l-2 border-muted pl-5",
					isDeleted && "opacity-60",
				)}
				data-testid={`comment-${comment.id}`}
			>
				{content}
				{dialogs}
			</div>
		)
	}

	return (
		<div data-testid={`comment-${comment.id}`}>
			<Surface
				as="article"
				size="default"
				className={cn("flex flex-col px-6 py-4", isDeleted && "opacity-60")}
			>
				{content}
			</Surface>
			{dialogs}
		</div>
	)
}

type ReplyTreeProps = {
	readonly parentId: string
	readonly all: readonly Comment[]
	readonly depth: number
	readonly trash: boolean
	readonly hideActions: boolean
	readonly context?: CommentItemProps["context"]
}

function CommentReplyTree(props: ReplyTreeProps) {
	const direct = props.all.filter((c) => c.parentId === props.parentId)
	if (direct.length === 0) return undefined
	return (
		<>
			{direct.map((c, index) => (
				<CommentItem
					key={c.id}
					comment={c}
					replies={props.all}
					depth={props.depth}
					trash={props.trash}
					hideActions={props.hideActions}
					replyNumber={props.depth === 1 ? index + 1 : undefined}
					context={props.context}
				/>
			))}
		</>
	)
}
