import type { CommentCreateInput, ResAnchor } from "@hoardodile/schemas"
import { MAX_COMMENT_BODY_LENGTH } from "@hoardodile/sdk-types/text-limits"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Surface } from "@hoardodile/ui/components/surface"
import { Textarea } from "@hoardodile/ui/components/textarea"
import { Gallery, User } from "@hoardodile/ui/icons/registry"
import { type KeyboardEvent, useState } from "react"
import { useTranslation } from "react-i18next"
import { CharChipsPicker } from "@/features/char/components/CharChipsPicker"
import { CharSelectorDialog } from "@/features/char/components/CharSelectorDialog"
import { createCommentMutation, invalidateComments } from "@/features/comments"
import { useSaveMutation } from "@/hooks/useSaveMutation"
import { ResChipsPicker } from "../res/components/ResChipsPicker"
import { ResSelectorDialog } from "../res/components/ResSelectorDialog"
import { MessageTextAction } from "./MessageTextAction"

export type CommentComposerVariant = "standalone" | "reply" | "embedded"

export type CommentComposerProps = {
	readonly parentId?: string
	readonly initialCharacterIds?: readonly string[]
	readonly initialResourceIds?: readonly string[]
	/** When true, {@link initialCharacterIds} cannot be removed from the chip row. */
	readonly lockInitialCharacterLinks?: boolean
	/** When true, {@link initialResourceIds} cannot be removed from the chip row. */
	readonly lockInitialResourceLinks?: boolean
	/**
	 * Pointer into a specific block of a resource (e.g. a page or a
	 * video timestamp). When set, the composer attaches the anchor to
	 * the new comment without exposing UI for it — readers seed the
	 * anchor based on the user's current scroll position.
	 */
	readonly initialAnchor?: ResAnchor
	readonly onPosted?: () => void
	readonly placeholder?: string
	readonly testId?: string
	readonly variant?: CommentComposerVariant
}

const CHARS_REMAINING_THRESHOLD = 500

/**
 * Single composer used both for top-level comments and for inline
 * replies. The `parentId` decides whether the create call nests the
 * new row under another thread.
 */
function mergeLockedIds(
	next: readonly string[],
	lockedIds: readonly string[] | undefined,
): readonly string[] {
	const locked = lockedIds ?? []
	if (locked.length === 0) return next
	const extras = next.filter((id) => !locked.includes(id))
	return [...locked, ...extras]
}

export function CommentComposer(props: CommentComposerProps) {
	const { t } = useTranslation()
	const variant = props.variant ?? "standalone"
	const lockedCharacterIds = props.lockInitialCharacterLinks
		? props.initialCharacterIds
		: undefined
	const lockedResourceIds = props.lockInitialResourceLinks
		? props.initialResourceIds
		: undefined
	const [body, setBody] = useState("")
	const [charIds, setCharacterIds] = useState<readonly string[]>(
		props.initialCharacterIds ?? [],
	)
	const [resIds, setResourceIds] = useState<readonly string[]>(
		props.initialResourceIds ?? [],
	)
	const [charDialogOpen, setCharDialogOpen] = useState(false)
	const [resDialogOpen, setResDialogOpen] = useState(false)

	const createMut = useSaveMutation({
		mutationOptions: createCommentMutation(),
		invalidate: invalidateComments,
		successMessageKey: "messages.toast.posted",
		errorMessageKey: "messages.toast.postFailed",
		onSaved() {
			setBody("")
			setCharacterIds(props.initialCharacterIds ?? [])
			setResourceIds(props.initialResourceIds ?? [])
			props.onPosted?.()
		},
	})

	function handleCharacterChange(next: readonly string[]) {
		setCharacterIds(mergeLockedIds(next, lockedCharacterIds))
	}

	function handleResourceChange(next: readonly string[]) {
		setResourceIds(mergeLockedIds(next, lockedResourceIds))
	}

	function submit() {
		const trimmed = body.trim()
		if (trimmed.length === 0) return
		const input: CommentCreateInput = {
			body: trimmed,
			parentId: props.parentId,
			charIds: charIds.length > 0 ? [...charIds] : undefined,
			resIds: resIds.length > 0 ? [...resIds] : undefined,
			anchor:
				props.initialAnchor === undefined
					? undefined
					: { data: props.initialAnchor.data },
			anchorResId: props.initialAnchor?.resId,
		}
		createMut.mutate(input)
	}

	function handleKeyDown(e: KeyboardEvent<HTMLTextAreaElement>) {
		if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) {
			e.preventDefault()
			submit()
		}
	}

	const charsRemaining = MAX_COMMENT_BODY_LENGTH - body.length
	const showCharsRemaining = charsRemaining <= CHARS_REMAINING_THRESHOLD

	const composerBody = (
		<>
			{/* Body block — design MessageComposer: the text sits flush with
			    the card top (no padding on the textarea itself) and the
			    footer divider sits 16px below it (`pb-4`). */}
			<div className="flex flex-col">
				<Textarea
					value={body}
					onChange={(e) => setBody(e.target.value)}
					onKeyDown={handleKeyDown}
					maxLength={MAX_COMMENT_BODY_LENGTH}
					placeholder={
						props.placeholder ??
						t(
							props.parentId !== undefined
								? "messages.replyPlaceholder"
								: "messages.composerPlaceholder",
						)
					}
					rows={1}
					className="min-h-10 px-0 py-0 resize-none bg-transparent focus-visible:ring-0 field-sizing-content"
				/>
				{charIds.length > 0 ? (
					<CharChipsPicker
						ids={charIds}
						className="mb-2 mt-2"
						onChange={handleCharacterChange}
						lockedIds={lockedCharacterIds}
					/>
				) : null}
				{resIds.length > 0 ? (
					<ResChipsPicker
						ids={resIds}
						className="mb-2"
						onChange={handleResourceChange}
						lockedIds={lockedResourceIds}
					/>
				) : null}
			</div>
			<div className="flex items-center gap-4 border-t border-border pt-3">
				{charIds.length === 0 ? (
					<MessageTextAction
						onClick={() => setCharDialogOpen(true)}
						data-testid={
							props.testId !== undefined
								? `${props.testId}-add-character-row`
								: undefined
						}
					>
						<Icon icon={User} />
						{t("messages.linkCharactersAdd")}
					</MessageTextAction>
				) : null}
				{resIds.length === 0 ? (
					<MessageTextAction
						onClick={() => setResDialogOpen(true)}
						data-testid={
							props.testId !== undefined
								? `${props.testId}-add-resource-row`
								: undefined
						}
					>
						<Icon icon={Gallery} />
						{t("messages.linkResourcesAdd")}
					</MessageTextAction>
				) : null}
				<div className="ml-auto flex items-center gap-2">
					{showCharsRemaining ? (
						<span className="text-tiny text-muted-foreground tabular-nums">
							{t("messages.charsRemaining", { count: charsRemaining })}
						</span>
					) : null}
					<Button
						type="button"
						className="px-4"
						onClick={submit}
						disabled={createMut.isPending || body.trim().length === 0}
					>
						{createMut.isPending
							? t("messages.submitting")
							: t("messages.submit")}
					</Button>
				</div>
			</div>
			<CharSelectorDialog
				open={charDialogOpen}
				mode="multi"
				initialSelected={charIds}
				lockedIds={lockedCharacterIds}
				onConfirm={(next) => {
					handleCharacterChange(next)
					setCharDialogOpen(false)
				}}
				onOpenChange={setCharDialogOpen}
			/>
			<ResSelectorDialog
				open={resDialogOpen}
				mode="multi"
				initialSelected={resIds}
				lockedIds={lockedResourceIds}
				onConfirm={(next) => {
					handleResourceChange(next)
					setResDialogOpen(false)
				}}
				onOpenChange={setResDialogOpen}
			/>
		</>
	)

	if (variant === "reply") {
		return (
			<Surface
				size="compact"
				className="flex flex-col bg-muted/30 focus-within:ring-2 focus-within:ring-ring/20"
				data-testid={props.testId}
			>
				{composerBody}
			</Surface>
		)
	}

	return (
		<Surface
			size="default"
			className="flex flex-col px-6 py-4 focus-within:ring-2 focus-within:ring-ring/20"
			data-testid={props.testId}
		>
			{composerBody}
		</Surface>
	)
}
