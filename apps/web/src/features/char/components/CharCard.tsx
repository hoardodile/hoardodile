import type { Character, CharCard as CharCardData } from "@hoardodile/schemas"
import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Checkbox } from "@hoardodile/ui/components/checkbox"
import { ConfirmByTypingDialog } from "@hoardodile/ui/components/confirm-by-typing-dialog"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuItem,
	DropdownMenuSeparator,
	DropdownMenuSub,
	DropdownMenuSubContent,
	DropdownMenuSubTrigger,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { More } from "@hoardodile/ui/icons/actions"
import {
	ChatRound,
	Gallery,
	Pen,
	Share,
	Tag,
	TrashBinMinimalistic,
	UndoRightRound,
	Upload,
	User,
	UserId,
} from "@hoardodile/ui/icons/registry"
import type { QueryClient } from "@tanstack/react-query"
import { useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { memo, type ReactElement, useCallback, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { DualTagPicker } from "@/components/common/DualTagPicker"
import { SelectionDiffPanel } from "@/components/common/SelectionDiffPanel"
import { useDateFormatter } from "@/features/settings/datePrefs"
import {
	attachToCharacterMutation,
	detachFromCharacterMutation,
	tagKeys,
	tagsForCharacterQueryOptions,
} from "@/features/tags"
import { TagChipHover } from "@/features/tags/TagChipHover"
import { TagChipLink } from "@/features/tags/TagChipLink"
import { formatTraitValue } from "@/features/traits/formatTraitValue"
import { useSaveMutation } from "@/hooks/useSaveMutation"
import {
	hardDeleteCharacterMutation,
	invalidateCharacters,
	restoreCharacterMutation,
	softDeleteCharacterMutation,
} from "../api"
import { CharChip } from "./CharChip"
import {
	CharBasicEditDialog,
	CharImageEditDialog,
	CharRelationsEditDialog,
	CharTraitsEditDialog,
} from "./CharEditDialogs"
import { CharThumb } from "./CharThumb"

// ── Selection ────────────────────────────────────────────────────────────────

export type CharCardSelection = {
	readonly selected: boolean
	readonly onToggle: () => void
}

// ── Props ────────────────────────────────────────────────────────────────────

export type CharCardProps = {
	/**
	 * Character data with pre-computed pinned tags, as returned by
	 * `character.listCards` or `character.detailCard`.
	 */
	readonly character: CharCardData
	readonly className?: string
	/**
	 * When provided the card switches to selection mode: the actions menu is
	 * hidden, navigation links become inert, and a checkbox in the bottom-right
	 * corner reflects / toggles `selected`.
	 */
	readonly selection?: CharCardSelection
	/**
	 * When provided, the avatar thumbnail becomes a button that calls this
	 * handler instead of linking to the detail page.
	 */
	readonly onAvatarClick?: () => void
	/**
	 * Browse-mode open handler: when provided, the avatar and the name
	 * become buttons that call it with the card's root element instead of
	 * linking — the grid wires it to the shared-element card transition
	 * (DESIGN.md — the cover travel).
	 */
	readonly onOpenCard?: (card: HTMLElement) => void
}

/**
 * Self-contained display card for a character in list / grid views.
 *
 * Two modes:
 *  - **browse** (default): clickable links, three-dot action menu, sub-dialogs.
 *  - **select** (when `selection` is provided): no navigation, no menu, a
 *    bottom-right checkbox reflecting the current selection state.
 */
export const CharCard = memo(function CharCard(props: CharCardProps) {
	const { character, className, selection, onAvatarClick, onOpenCard } = props
	const {
		id,
		name,
		updatedAt,
		createdAt,
		pinnedTraits,
		pinnedTags,
		relations,
	} = character
	const { formatDateTime, formatDateTrait } = useDateFormatter()
	const isSelectMode = selection !== undefined
	const rootRef = useRef<HTMLDivElement | null>(null)

	function handleToggleClick() {
		if (selection !== undefined) selection.onToggle()
	}

	function handleOpenCard() {
		if (onOpenCard === undefined) return
		const root = rootRef.current
		if (root !== null) onOpenCard(root)
	}

	return (
		<div
			ref={rootRef}
			className={`relative flex w-50 flex-col gap-1 ${className ?? ""}`}
			data-testid={`character-item-${id}`}
		>
			{/* The selection ring hugs the thumb only. */}
			<div
				className={`group relative rounded-xl ${selection?.selected ? "ring-2 ring-primary" : ""}`}
			>
				{isSelectMode ? (
					<button
						type="button"
						onClick={handleToggleClick}
						aria-label={`Toggle selection for ${name}`}
						aria-pressed={selection.selected}
						className="block w-full cursor-pointer"
						data-testid={`character-select-${id}`}
					>
						<CharThumb
							charId={id}
							variant="avatar"
							cacheKey={updatedAt}
							name={name}
							className="aspect-square w-full"
						/>
					</button>
				) : onAvatarClick !== undefined ? (
					<button
						type="button"
						onClick={onAvatarClick}
						aria-label={`Preview avatar for ${name}`}
						className="block w-full cursor-pointer"
						data-testid={`character-avatar-preview-${id}`}
					>
						<CharThumb
							charId={id}
							variant="avatar"
							cacheKey={updatedAt}
							name={name}
							className="aspect-square w-full"
						/>
					</button>
				) : onOpenCard !== undefined ? (
					<button
						type="button"
						onClick={handleOpenCard}
						aria-label={`Open ${name}`}
						className="block w-full cursor-pointer"
						data-testid={`character-open-${id}`}
					>
						<CharThumb
							charId={id}
							variant="avatar"
							cacheKey={updatedAt}
							name={name}
							className="aspect-square w-full"
						/>
					</button>
				) : (
					<Link
						to="/characters/$id"
						params={{ id }}
						className="block"
						data-testid={`character-link-${id}`}
					>
						<CharThumb
							charId={id}
							variant="avatar"
							cacheKey={updatedAt}
							name={name}
							className="aspect-square w-full"
						/>
					</Link>
				)}

				{!isSelectMode ? <CharCardActions character={character} /> : null}

				{isSelectMode ? (
					<div className="absolute -top-2 -right-2 z-30">
						<Checkbox
							// The check sits more inset so the box reads as a
							// padded overlay, not a sticker crowding the cover.
							className="size-5 rounded-full border-2 border-border-strong bg-card [&>svg]:size-2.5"
							checked={selection.selected}
							onCheckedChange={() => selection.onToggle()}
							aria-label={`Select ${name}`}
							data-testid={`character-select-checkbox-${id}`}
						/>
					</div>
				) : null}
			</div>

			<div className="overflow-hidden">
				{isSelectMode ? (
					<span className="block truncate text-base font-medium" title={name}>
						{name}
					</span>
				) : onOpenCard !== undefined ? (
					<button
						type="button"
						onClick={handleOpenCard}
						className="block w-full truncate text-left text-base font-medium hover:underline"
						title={name}
						data-testid={`character-open-name-${id}`}
					>
						{name}
					</button>
				) : (
					<div className="block truncate text-base font-medium">
						<Link
							to="/characters/$id"
							params={{ id }}
							className="hover:underline"
							title={name}
						>
							{name}
						</Link>
					</div>
				)}
			</div>

			{pinnedTags.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{pinnedTags.map((tag) => (
						<TagChipHover key={tag.id} tagId={tag.id}>
							<TagChipLink
								id={tag.id}
								type="character"
								name={tag.name}
								color={tag.color}
								virtual={tag.virtual}
								className="max-w-25"
							/>
						</TagChipHover>
					))}
				</div>
			) : null}
			{pinnedTraits.length > 0
				? pinnedTraits.map((row) => (
						<div
							key={row.id}
							className="flex flex-wrap items-baseline gap-x-1.5 text-xs"
							data-testid={`character-pinned-trait-${row.id}`}
						>
							<TagChipLink
								id={row.id}
								type="character"
								name={row.name}
								color={row.color}
								link={false}
								className="max-w-25"
							/>
							<span className="wrap-break-word text-muted-foreground">
								{formatTraitValue(row, formatDateTrait)}
							</span>
						</div>
					))
				: null}
			{relations.length > 0 ? (
				<div className="flex flex-wrap gap-1.5">
					{relations.map((rel) => (
						<CharChip
							key={rel.id}
							charId={rel.id}
							character={{
								name: rel.name,
								updatedAt: rel.updatedAt,
								imageMeta: rel.imageMeta,
							}}
							subLabel={rel.labels.join(" · ")}
							color={rel.color}
							disableLink={isSelectMode}
						/>
					))}
				</div>
			) : null}
			<span className="text-tiny text-muted-foreground text-right">
				{formatDateTime(createdAt)}
			</span>
		</div>
	)
})

// ── CharCardActions (merged from CharCardActions.tsx) ────────────────────────

type DialogKind =
	| "basic"
	| "traits"
	| "relations"
	| "avatar"
	| "fullbody"
	| "tags"

export type CharCardActionsProps = {
	readonly character: Character
	/**
	 * When provided, replaces the default card-corner trigger with a
	 * caller-supplied element (the same affordance as
	 * `ResCardActions`). The element is passed to
	 * `DropdownMenuTrigger`'s `render` prop.
	 */
	readonly renderTrigger?: () => ReactElement
}

/**
 * Three-dot actions menu for a {@link CharCard}. The "Edit" item now
 * expands a submenu with one entry per editable section, plus tags. Each
 * entry opens a dedicated dialog instead of a tabbed hub.
 */
export function CharCardActions(props: CharCardActionsProps) {
	const { character, renderTrigger } = props
	const charId = character.id
	const charName = character.name
	const isTrashed = character.deletedAt !== undefined
	const { t } = useTranslation()
	const [hardDeleteOpen, setHardDeleteOpen] = useState(false)
	const [openDialog, setOpenDialog] = useState<DialogKind | undefined>(
		undefined,
	)
	const [confirmText, setConfirmText] = useState("")

	const invalidateCharAndDetail = useCallback(
		function invalidate(client: QueryClient) {
			return invalidateCharacters(client, charId)
		},
		[charId],
	)

	const softDeleteMut = useSaveMutation({
		mutationOptions: softDeleteCharacterMutation(),
		invalidate: invalidateCharAndDetail,
		successMessageKey: "characters.toast.movedToTrash",
		errorMessageKey: "characters.toast.deleteFailed",
	})

	const restoreMut = useSaveMutation({
		mutationOptions: restoreCharacterMutation(),
		invalidate: invalidateCharAndDetail,
		successMessageKey: "characters.toast.restored",
		errorMessageKey: "characters.toast.restoreFailed",
	})

	const hardMut = useSaveMutation({
		mutationOptions: hardDeleteCharacterMutation(),
		invalidate: invalidateCharAndDetail,
		onSaved() {
			setHardDeleteOpen(false)
			setConfirmText("")
		},
		successMessageKey: "characters.toast.deletedForever",
		errorMessageKey: "characters.toast.deleteFailed",
	})

	function handleHardDeleteDialogChange(open: boolean) {
		if (open) return
		setHardDeleteOpen(false)
		setConfirmText("")
	}

	function handleDialogChange(kind: DialogKind, next: boolean) {
		if (!next && openDialog === kind) setOpenDialog(undefined)
	}

	/** The default card-corner trigger — hover-revealed on the cover. */
	function defaultTrigger() {
		return (
			<button
				type="button"
				aria-label={t("characters.actionsAria", { name: charName })}
				data-testid={`character-actions-${charId}`}
				className="pointer-events-auto absolute right-2 top-2 z-10 flex h-7 w-7 items-center justify-center rounded-full bg-foreground/90 text-background opacity-100 shadow-card transition-opacity duration-200 focus-visible:opacity-100 md:pointer-events-none md:opacity-0 md:group-hover:pointer-events-auto md:group-hover:opacity-100 hover:bg-foreground hover:text-background"
			>
				<More className="h-4 w-4" />
			</button>
		)
	}

	return (
		<>
			<DropdownMenu modal={false}>
				<DropdownMenuTrigger
					render={
						renderTrigger !== undefined ? renderTrigger() : defaultTrigger()
					}
				/>
				<DropdownMenuContent align="end" className="w-44">
					{isTrashed ? (
						<>
							<DropdownMenuItem
								onClick={() => restoreMut.mutate(charId)}
								disabled={restoreMut.isPending}
								data-testid={`character-action-restore-${charId}`}
							>
								<UndoRightRound className="h-4 w-4" />
								{t("characters.actions.restore")}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
						</>
					) : null}
					<DropdownMenuItem
						data-testid={`character-action-upload-resource-${charId}`}
						render={
							<Link
								to="/resources/new"
								search={{ charId }}
								className="flex w-full items-center gap-2"
							>
								<Upload className="h-4 w-4" />
								{t("characters.actions.uploadResource")}
							</Link>
						}
					/>
					<DropdownMenuSub>
						<DropdownMenuSubTrigger
							data-testid={`character-action-edit-${charId}`}
						>
							<Pen className="h-4 w-4" />
							{t("common.edit")}
						</DropdownMenuSubTrigger>
						<DropdownMenuSubContent className="w-44">
							<DropdownMenuItem
								onClick={() => setOpenDialog("tags")}
								data-testid={`character-action-edit-tags-${charId}`}
							>
								<Tag className="h-4 w-4" />
								{t("characters.actions.editTags")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => setOpenDialog("traits")}
								data-testid={`character-action-edit-traits-${charId}`}
							>
								<UserId className="h-4 w-4" />
								{t("characters.actions.editTraits")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => setOpenDialog("relations")}
								data-testid={`character-action-edit-relations-${charId}`}
							>
								<Share className="h-4 w-4" />
								{t("characters.actions.editRelations")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => setOpenDialog("basic")}
								data-testid={`character-action-edit-basic-${charId}`}
							>
								<Pen className="h-4 w-4" />
								{t("characters.actions.editBasic")}
							</DropdownMenuItem>
							<DropdownMenuSeparator />
							<DropdownMenuItem
								onClick={() => setOpenDialog("avatar")}
								data-testid={`character-action-edit-avatar-${charId}`}
							>
								<User className="h-4 w-4" />
								{t("characters.actions.editAvatar")}
							</DropdownMenuItem>
							<DropdownMenuItem
								onClick={() => setOpenDialog("fullbody")}
								data-testid={`character-action-edit-fullbody-${charId}`}
							>
								<Gallery className="h-4 w-4" />
								{t("characters.actions.editFullbody")}
							</DropdownMenuItem>
						</DropdownMenuSubContent>
					</DropdownMenuSub>

					<DropdownMenuItem
						data-testid={`character-action-comments-${charId}`}
						render={
							<Link
								to="/messages"
								search={{ charId }}
								className="flex w-full items-center gap-2"
							>
								<ChatRound className="h-4 w-4" />
								{t("characters.actions.openMessages")}
							</Link>
						}
					/>
					<DropdownMenuSeparator />
					{isTrashed ? (
						<DropdownMenuItem
							variant="destructive"
							onClick={() => setHardDeleteOpen(true)}
							data-testid={`character-action-hard-delete-${charId}`}
						>
							<TrashBinMinimalistic className="h-4 w-4" />
							{t("characters.actions.hardDelete")}
						</DropdownMenuItem>
					) : (
						<DropdownMenuItem
							variant="destructive"
							onClick={() => softDeleteMut.mutate(charId)}
							disabled={softDeleteMut.isPending}
							data-testid={`character-action-delete-${charId}`}
						>
							<TrashBinMinimalistic className="h-4 w-4" />
							{t("characters.actions.softDelete")}
						</DropdownMenuItem>
					)}
				</DropdownMenuContent>
			</DropdownMenu>

			{openDialog === "basic" ? (
				<CharBasicEditDialog
					open
					character={character}
					onOpenChange={(n) => handleDialogChange("basic", n)}
				/>
			) : null}
			{openDialog === "traits" ? (
				<CharTraitsEditDialog
					open
					character={character}
					onOpenChange={(n) => handleDialogChange("traits", n)}
				/>
			) : null}
			{openDialog === "relations" ? (
				<CharRelationsEditDialog
					open
					character={character}
					onOpenChange={(n) => handleDialogChange("relations", n)}
				/>
			) : null}
			{openDialog === "avatar" ? (
				<CharImageEditDialog
					open
					charId={charId}
					charName={charName}
					variant="avatar"
					onOpenChange={(n) => handleDialogChange("avatar", n)}
				/>
			) : null}
			{openDialog === "fullbody" ? (
				<CharImageEditDialog
					open
					charId={charId}
					charName={charName}
					variant="fullbody"
					onOpenChange={(n) => handleDialogChange("fullbody", n)}
				/>
			) : null}
			{openDialog === "tags" ? (
				<CharTagsDialog
					open
					character={{ id: charId, name: charName }}
					onOpenChange={(n) => handleDialogChange("tags", n)}
				/>
			) : null}

			{hardDeleteOpen ? (
				<ConfirmByTypingDialog
					open
					onOpenChange={handleHardDeleteDialogChange}
					title={t("characters.hardDelete.title")}
					description={t("characters.hardDelete.description")}
					targetName={charName}
					expectedInput={charName}
					typed={confirmText}
					onTypedChange={setConfirmText}
					pending={hardMut.isPending}
					confirmLabel={t("characters.hardDelete.confirm")}
					pendingLabel={t("characters.hardDelete.deleting")}
					onConfirm={() => hardMut.mutate(charId)}
					inputTestId={`hard-delete-confirm-input-${charId}`}
					confirmTestId={`hard-delete-confirm-${charId}`}
				/>
			) : null}
		</>
	)
}

// ── CharTagsDialog (merged from CharTagsDialog.tsx + CharTagsPanel.tsx) ──────

function CharTagsDialog(props: {
	readonly open: boolean
	readonly character: Pick<Character, "id" | "name">
	readonly onOpenChange: (open: boolean) => void
}) {
	const { open, character, onOpenChange } = props
	const { t } = useTranslation()
	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("characters.tagsDialog.title", { name: character.name })}
			size="lg"
			footer={
				<Button
					type="button"
					variant="secondary"
					onClick={() => onOpenChange(false)}
				>
					{t("common.cancel")}
				</Button>
			}
		>
			<CharTagsPanel
				charId={character.id}
				onSaved={() => onOpenChange(false)}
			/>
		</AppDialog>
	)
}

function CharTagsPanel(props: {
	readonly charId: string
	readonly onSaved?: () => void
}) {
	const { charId, onSaved } = props
	const qc = useQueryClient()
	return (
		<SelectionDiffPanel
			query={tagsForCharacterQueryOptions(charId)}
			getId={(t) => t.id}
			attach={attachToCharacterMutation()}
			detach={detachFromCharacterMutation()}
			buildPayload={(tagId) => ({ entityId: charId, tagId })}
			invalidate={async () => {
				await qc.invalidateQueries({
					queryKey: tagKeys.forCharacter(charId),
				})
				await invalidateCharacters(qc, charId)
			}}
			submitTestId="character-edit-tags-submit"
			onSaved={onSaved}
		>
			{({ selected, setSelected }) => (
				<DualTagPicker
					value={selected}
					onChange={setSelected}
					kind="character"
				/>
			)}
		</SelectionDiffPanel>
	)
}
