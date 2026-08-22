import type {
	Character,
	Charactership,
	RelationshipType,
} from "@hoardodile/schemas"
import { MAX_NAME_LENGTH } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuRadioGroup,
	DropdownMenuRadioItem,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { Input } from "@hoardodile/ui/components/input"
import { Surface } from "@hoardodile/ui/components/surface"
import { toast } from "@hoardodile/ui/components/toast"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@hoardodile/ui/components/tooltip"
import { Cross } from "@hoardodile/ui/icons/marks"
import { AltArrowDown, Help, User } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { keyBy } from "es-toolkit"
import {
	type ReactNode,
	useEffect,
	useId,
	useMemo,
	useRef,
	useState,
} from "react"
import { useTranslation } from "react-i18next"
import { AddGridPill } from "@/components/common/AddGridPill"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { useConfirmDialog } from "@/components/common/useConfirmDialog"
import { TagChip } from "@/features/tags/TagChip"
import { TagChipLink } from "@/features/tags/TagChipLink"
import { errorMessage } from "@/lib/errors"
import { randomUUID } from "@/lib/randomUUID"
import {
	charactershipsQueryOptions,
	createCharactershipMutation,
	deleteCharactershipMutation,
	invalidateCharacterships,
	relationshipTypesQueryOptions,
} from "../api"
import {
	anchorIsOnLeft,
	buildCreateCharactershipInput,
	type CharactershipDraftInput,
	type DraftAnchorSide,
	type DraftOtherTarget,
	isCharactershipDraftComplete,
	isExternalCharactership,
	otherCharacterId,
	resolveCharactershipSideLabels,
	resolveDraftSideLabels,
} from "../utils/charactershipLabels"
import { AddRelationshipTypeDialog } from "./AddRelationshipTypeDialog"
import { CharSelectorDialog, useCharactersByIds } from "./CharSelectorDialog"
import { CharThumb } from "./CharThumb"
import { RelationshipKindIcon } from "./RelationshipKindBadge"

type DraftRow = CharactershipDraftInput & {
	readonly draftId: string
}

const PICK_ACTION_NAME = "name"
const PICK_ACTION_CHARACTER = "character"

function emptyDraft(typeId: string): DraftRow {
	return {
		draftId: randomUUID(),
		typeId,
		anchorSide: null,
		otherSide: null,
		otherTarget: null,
	}
}

export type CharactershipPanelProps = {
	readonly open: boolean
	readonly charId: string
	readonly charName: string
	readonly charUpdatedAt: number
	readonly onSaved?: () => void
}

export function CharactershipPanel(props: CharactershipPanelProps) {
	const { open, charId, charName, charUpdatedAt, onSaved } = props
	const { t } = useTranslation()
	const qc = useQueryClient()
	const edgesQ = useQuery(charactershipsQueryOptions(charId))
	const typesQ = useQuery(relationshipTypesQueryOptions())
	const types: readonly RelationshipType[] = typesQ.data ?? []
	const serverEdges: readonly Charactership[] = edgesQ.data ?? []
	const [drafts, setDrafts] = useState<readonly DraftRow[]>([])
	const [savingDraftId, setSavingDraftId] = useState<string | undefined>(
		undefined,
	)
	const wasOpenRef = useRef(false)
	const deleteConfirm = useConfirmDialog<{ edgeId: string }>()

	useEffect(() => {
		if (open && !wasOpenRef.current) {
			setDrafts([])
		}
		wasOpenRef.current = open
	}, [open])

	const visibleEdges = serverEdges

	const otherIds = useMemo(() => {
		const ids = new Set<string>()
		for (const edge of visibleEdges) {
			const otherId = otherCharacterId(edge, charId)
			if (otherId !== undefined) ids.add(otherId)
		}
		for (const draft of drafts) {
			if (draft.otherTarget?.kind === "character") {
				ids.add(draft.otherTarget.id)
			}
		}
		return [...ids]
	}, [visibleEdges, drafts, charId])
	const charsQ = useCharactersByIds(otherIds)
	const charById = useMemo(
		() => keyBy(charsQ.data ?? [], (item) => item.id),
		[charsQ.data],
	)

	const createMut = useMutation({
		...createCharactershipMutation(),
	})
	const deleteMut = useMutation({
		...deleteCharactershipMutation(),
	})

	async function invalidateCharactershipData() {
		await invalidateCharacterships(qc, charId)
	}

	function handleAddType(typeId: string) {
		setDrafts((prev) => [...prev, emptyDraft(typeId)])
	}

	function handleRemoveDraft(draftId: string) {
		setDrafts((prev) => prev.filter((row) => row.draftId !== draftId))
	}

	function updateDraft(draftId: string, patch: Partial<DraftRow>) {
		setDrafts((prev) =>
			prev.map((row) => (row.draftId === draftId ? { ...row, ...patch } : row)),
		)
	}

	function handleOtherTargetChange(
		draftId: string,
		side: DraftAnchorSide,
		target: DraftOtherTarget | null,
	) {
		if (target === null) {
			updateDraft(draftId, {
				anchorSide: null,
				otherSide: null,
				otherTarget: null,
			})
			return
		}
		updateDraft(draftId, {
			otherSide: side,
			anchorSide: side === "left" ? "right" : "left",
			otherTarget: target,
		})
	}

	async function handleSaveDraft(draft: DraftRow) {
		if (!isCharactershipDraftComplete(draft)) {
			toast.add({
				title: t("characters.charactership.incompleteDraft"),
				type: "error",
			})
			return
		}
		const payload = buildCreateCharactershipInput(charId, draft)
		if (payload === undefined) {
			toast.add({
				title: t("characters.charactership.incompleteDraft"),
				type: "error",
			})
			return
		}
		setSavingDraftId(draft.draftId)
		try {
			await createMut.mutateAsync(payload)
			await invalidateCharactershipData()
			handleRemoveDraft(draft.draftId)
			toast.add({
				title: t("characters.charactership.toast.addSuccess"),
				type: "success",
			})
			onSaved?.()
		} catch (err) {
			toast.add({
				title: errorMessage(
					err,
					t("characters.charactership.toast.saveFailed"),
				),
				type: "error",
			})
		} finally {
			setSavingDraftId(undefined)
		}
	}

	const isLoading = edgesQ.isLoading || typesQ.isLoading
	const anchor = { id: charId, name: charName, updatedAt: charUpdatedAt }

	return (
		<>
			<div className="flex flex-col gap-3" data-testid="charactership-panel">
				<AddRelationshipTypePicker types={types} onPick={handleAddType} />

				{isLoading ? (
					<p className="text-sm text-muted-foreground">{t("common.loading")}</p>
				) : null}

				{!isLoading && visibleEdges.length === 0 && drafts.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("characters.charactership.empty")}
					</p>
				) : null}

				<ul className="flex flex-col gap-2">
					{serverEdges.map((edge) => {
						const type = types.find((item) => item.id === edge.typeId)
						const otherId = otherCharacterId(edge, charId)
						const isDeleting =
							deleteMut.isPending && deleteConfirm.target?.edgeId === edge.id
						return (
							<li key={edge.id}>
								<CharactershipRow
									anchor={anchor}
									type={type}
									edge={edge}
									otherCharacter={
										otherId === undefined ? undefined : charById[otherId]
									}
									externalName={
										isExternalCharactership(edge)
											? edge.externalName
											: undefined
									}
									pending={isDeleting}
									onDelete={() => deleteConfirm.open({ edgeId: edge.id })}
								/>
							</li>
						)
					})}
					{drafts.map((draft) => {
						const type = types.find((item) => item.id === draft.typeId)
						const canSave = isCharactershipDraftComplete(draft)
						const saving = savingDraftId === draft.draftId
						return (
							<li key={draft.draftId}>
								<CharactershipRow
									anchor={anchor}
									type={type}
									draft={draft}
									charById={charById}
									pending={saving}
									onRemoveDraft={() => handleRemoveDraft(draft.draftId)}
									onOtherTargetChange={(side, target) =>
										handleOtherTargetChange(draft.draftId, side, target)
									}
									saveAction={
										<Button
											type="button"
											size="sm"
											disabled={!canSave || saving}
											onClick={() => handleSaveDraft(draft)}
											data-testid={`charactership-save-${draft.draftId}`}
										>
											{saving ? t("common.saving") : t("common.save")}
										</Button>
									}
								/>
							</li>
						)
					})}
				</ul>
			</div>
			<ConfirmDialog
				open={deleteConfirm.isOpen}
				onOpenChange={deleteConfirm.onOpenChange}
				title={t("characters.charactership.deleteConfirmTitle")}
				description={t("characters.charactership.deleteConfirmDescription")}
				confirmLabel={t("common.delete")}
				isPending={deleteMut.isPending}
				destructive
				onConfirm={async () => {
					const edgeId = deleteConfirm.target?.edgeId
					if (edgeId === undefined) return
					try {
						await deleteMut.mutateAsync(edgeId)
						await invalidateCharactershipData()
						toast.add({
							title: t("characters.charactership.toast.deleteSuccess"),
							type: "success",
						})
						onSaved?.()
					} catch (err) {
						toast.add({
							title: errorMessage(
								err,
								t("characters.charactership.toast.deleteFailed"),
							),
							type: "error",
						})
					} finally {
						deleteConfirm.close()
					}
				}}
			/>
		</>
	)
}

function AddRelationshipTypePicker(props: {
	readonly types: readonly RelationshipType[]
	readonly onPick: (typeId: string) => void
}) {
	const { types, onPick } = props
	const { t } = useTranslation()
	const [addOpen, setAddOpen] = useState(false)

	if (types.length === 0) {
		return (
			<div className="flex flex-wrap items-center gap-2 rounded-lg border border-dashed bg-muted/30 p-3 text-sm text-muted-foreground">
				<Help className="size-4 shrink-0" />
				<span>{t("characters.charactership.noTypesHint")}</span>
				<Link
					to="/settings"
					className="text-primary underline-offset-4 hover:underline"
				>
					{t("characters.charactership.noTypesLink")}
				</Link>
				<AddGridPill
					label={t("me.custom.entity.relation")}
					onClick={() => setAddOpen(true)}
					testId="charactership-add-relation"
				/>
				<AddRelationshipTypeDialog open={addOpen} onOpenChange={setAddOpen} />
			</div>
		)
	}

	return (
		<div className="flex flex-wrap items-center gap-1.5">
			<div
				className="flex flex-wrap gap-1.5"
				data-testid="charactership-add-picker"
			>
				{types.map((type) => (
					<TagChip
						key={type.id}
						size="md"
						color={type.color}
						icon={
							<RelationshipKindIcon
								kind={type.kind}
								className="inline size-3"
							/>
						}
						onClick={() => onPick(type.id)}
						data-testid={`charactership-add-${type.id}`}
					>
						{type.name}
					</TagChip>
				))}
			</div>
			<AddGridPill
				label={t("me.custom.entity.relation")}
				onClick={() => setAddOpen(true)}
				testId="charactership-add-relation"
			/>
			<AddRelationshipTypeDialog open={addOpen} onOpenChange={setAddOpen} />
		</div>
	)
}

type CharactershipRowProps = {
	readonly anchor: Pick<Character, "id" | "name" | "updatedAt" | "imageMeta">
	readonly type: RelationshipType | undefined
	readonly edge?: Charactership
	readonly draft?: DraftRow
	readonly charById?: Record<string, Character>
	readonly otherCharacter?: Character
	readonly externalName?: string
	readonly pending?: boolean
	readonly onDelete?: () => void
	readonly onRemoveDraft?: () => void
	readonly onOtherTargetChange?: (
		side: DraftAnchorSide,
		target: DraftOtherTarget | null,
	) => void
	readonly saveAction?: ReactNode
}

function CharactershipRow(props: CharactershipRowProps) {
	const {
		anchor,
		type,
		edge,
		draft,
		charById = {},
		otherCharacter,
		externalName,
		pending,
		onDelete,
		onRemoveDraft,
		onOtherTargetChange,
		saveAction,
	} = props
	const { t } = useTranslation()
	const [dialogSide, setDialogSide] = useState<DraftAnchorSide | null>(null)
	const isDraft = draft !== undefined
	const removeHandler = isDraft ? onRemoveDraft : onDelete
	const typeId = draft?.typeId ?? type?.id ?? ""

	const anchorOnLeft =
		edge !== undefined
			? anchorIsOnLeft(edge, anchor.id)
			: draft?.anchorSide === "left"

	const labels =
		edge !== undefined
			? resolveCharactershipSideLabels(edge, type, anchor.id)
			: draft !== undefined
				? resolveDraftSideLabels(type, draft.anchorSide, typeId)
				: { leftLabel: "", rightLabel: "" }

	// The row always renders self on the left and target on the right.
	const externalSide: DraftAnchorSide | undefined =
		externalName === undefined
			? undefined
			: edge !== undefined
				? edge.selfId === null
					? "left"
					: "right"
				: draft?.anchorSide === "left"
					? "right"
					: "left"

	const connectorReversed = false

	const leftCharacter =
		edge !== undefined
			? anchorOnLeft
				? anchor
				: otherCharacter
			: resolveDraftCharacter(draft, charById, anchor, "left")

	const rightCharacter =
		edge !== undefined
			? anchorOnLeft
				? otherCharacter
				: anchor
			: resolveDraftCharacter(draft, charById, anchor, "right")

	function handlePickAction(side: DraftAnchorSide, action: string) {
		if (onOtherTargetChange === undefined) return
		if (action === PICK_ACTION_NAME) {
			onOtherTargetChange(side, { kind: "external", name: "" })
			return
		}
		if (action === PICK_ACTION_CHARACTER) {
			setDialogSide(side)
		}
	}

	return (
		<Surface
			size="compact"
			className="group flex flex-col gap-2 transition-colors hover:bg-muted/20"
			data-testid={
				edge !== undefined
					? `charactership-row-${edge.id}`
					: draft !== undefined
						? `charactership-draft-${draft.draftId}`
						: undefined
			}
		>
			<div className="flex flex-wrap items-start justify-between gap-2">
				{type !== undefined ? (
					<TagChipLink
						id={type.id}
						type="character"
						name={type.name}
						color={type.color}
						link={false}
						className="shrink-0"
					/>
				) : null}
				{removeHandler !== undefined ? (
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									type="button"
									variant="ghost"
									size="icon-xs"
									disabled={pending}
									onClick={removeHandler}
									aria-label={t("characters.charactership.deleteEdge")}
									data-testid={
										edge !== undefined
											? `charactership-delete-${edge.id}`
											: draft !== undefined
												? `charactership-draft-remove-${draft.draftId}`
												: undefined
									}
									className="shrink-0 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100"
								>
									<Cross className="size-3.5" />
								</Button>
							}
						/>
						<TooltipContent>
							{isDraft
								? t("common.cancel")
								: t("characters.charactership.deleteEdge")}
						</TooltipContent>
					</Tooltip>
				) : null}
			</div>

			<div className="flex flex-wrap items-center justify-center gap-2 sm:gap-3">
				<DraftSideColumn
					side="left"
					isDraft={isDraft}
					draft={draft}
					character={leftCharacter}
					label={labels.leftLabel}
					anchor={anchor}
					pending={pending}
					onOtherTargetChange={onOtherTargetChange}
					onPickAction={handlePickAction}
					externalName={externalName}
					externalSide={externalSide}
				/>

				<RowConnector
					bidirectional={type?.kind === "symmetric"}
					reversed={connectorReversed}
				/>

				<DraftSideColumn
					side="right"
					isDraft={isDraft}
					draft={draft}
					character={rightCharacter}
					label={labels.rightLabel}
					anchor={anchor}
					pending={pending}
					onOtherTargetChange={onOtherTargetChange}
					onPickAction={handlePickAction}
					externalName={externalName}
					externalSide={externalSide}
				/>
			</div>

			{saveAction !== undefined ? (
				<div className="flex justify-end pt-1">{saveAction}</div>
			) : null}

			{isDraft && dialogSide !== null && onOtherTargetChange !== undefined ? (
				<CharSelectorDialog
					open
					mode="single"
					excludeIds={[anchor.id]}
					title={t("characters.charactership.pickerTitle")}
					onSelect={(pickedId) => {
						onOtherTargetChange(dialogSide, {
							kind: "character",
							id: pickedId,
						})
						setDialogSide(null)
					}}
					onOpenChange={(next) => {
						if (!next) setDialogSide(null)
					}}
					confirmTestId={
						draft !== undefined
							? `charactership-picker-${draft.draftId}-${dialogSide}`
							: undefined
					}
				/>
			) : null}
		</Surface>
	)
}

function resolveDraftCharacter(
	draft: DraftRow | undefined,
	charById: Record<string, Character>,
	anchor: Pick<Character, "id" | "name" | "updatedAt" | "imageMeta">,
	side: DraftAnchorSide,
): Pick<Character, "id" | "name" | "updatedAt" | "imageMeta"> | undefined {
	if (draft === undefined) return undefined
	if (draft.anchorSide === side) return anchor
	if (draft.otherSide !== side || draft.otherTarget === null) return undefined
	if (draft.otherTarget.kind === "character") {
		return charById[draft.otherTarget.id]
	}
	return undefined
}

function DraftSideColumn(props: {
	readonly side: DraftAnchorSide
	readonly isDraft: boolean
	readonly draft: DraftRow | undefined
	readonly character:
		| Pick<Character, "id" | "name" | "updatedAt" | "imageMeta">
		| undefined
	readonly label: string
	readonly anchor: Pick<Character, "id" | "name" | "updatedAt" | "imageMeta">
	readonly pending?: boolean
	readonly onOtherTargetChange?: (
		side: DraftAnchorSide,
		target: DraftOtherTarget | null,
	) => void
	readonly onPickAction: (side: DraftAnchorSide, action: string) => void
	readonly externalName?: string
	readonly externalSide?: DraftAnchorSide
}) {
	const {
		side,
		isDraft,
		draft,
		character,
		label,
		pending,
		onOtherTargetChange,
		onPickAction,
		externalName,
		externalSide,
	} = props

	if (isDraft && draft !== undefined && onOtherTargetChange !== undefined) {
		const isOtherSide = draft.otherSide === side
		const isAnchorSide = draft.anchorSide === side
		const isEmpty = draft.anchorSide === null

		if (isEmpty) {
			return (
				<EndpointPickColumn
					label={label}
					pending={pending}
					testId={
						draft !== undefined
							? `charactership-pick-${draft.draftId}-${side}`
							: undefined
					}
					onPickAction={(action) => onPickAction(side, action)}
				/>
			)
		}

		if (isOtherSide && draft.otherTarget?.kind === "external") {
			return (
				<ExternalNameInputColumn
					name={draft.otherTarget.name}
					label={label}
					pending={pending}
					testId={
						draft !== undefined
							? `charactership-pick-${draft.draftId}-${side}`
							: undefined
					}
					onChange={(name) =>
						onOtherTargetChange(side, { kind: "external", name })
					}
					onPickAction={(action) => onPickAction(side, action)}
				/>
			)
		}

		if (isOtherSide || isAnchorSide) {
			return (
				<EndpointPickColumn
					label={label}
					character={character}
					pending={pending}
					testId={
						draft !== undefined
							? `charactership-pick-${draft.draftId}-${side}`
							: undefined
					}
					onPickAction={(action) => onPickAction(side, action)}
				/>
			)
		}
	}

	if (!isDraft && externalName !== undefined && side === externalSide) {
		return <ExternalNameColumn name={externalName} label={label} />
	}

	return <EndpointColumn character={character} label={label} testId={side} />
}

function EndpointPickColumn(props: {
	readonly label: string
	readonly character?: Pick<
		Character,
		"id" | "name" | "updatedAt" | "imageMeta"
	>
	readonly pending?: boolean
	readonly testId?: string
	readonly onPickAction: (action: string) => void
}) {
	const { label, character, pending, testId, onPickAction } = props
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)
	const displayName = character?.name ?? "—"

	function handleAction(action: string) {
		onPickAction(action)
		setOpen(false)
	}

	return (
		<div className="flex w-24 flex-col items-center gap-1">
			<DropdownMenu open={open} onOpenChange={setOpen}>
				<DropdownMenuTrigger
					disabled={pending}
					render={
						<button
							type="button"
							className="flex flex-col items-center gap-1 rounded-md transition-opacity hover:opacity-80 disabled:opacity-50"
							data-testid={testId}
							aria-label={t("characters.charactership.pickEndpoint")}
						>
							{character !== undefined ? (
								<>
									<CharThumb
										charId={character.id}
										variant="avatar"
										cacheKey={character.updatedAt}
										name={character.name}
										className="aspect-square w-16 rounded-md ring-1 ring-transparent transition-shadow hover:ring-ring/40"
										hoverOverlay={false}
									/>
									<span className="max-w-full truncate text-xs font-medium">
										{displayName}
									</span>
								</>
							) : (
								<>
									<span className="flex aspect-square w-16 items-center justify-center rounded-md border border-dashed bg-muted/15 transition-colors hover:bg-muted/30">
										<User
											className="size-5 text-muted-foreground/60"
											aria-hidden
										/>
									</span>
									<span className="max-w-full truncate text-tiny text-muted-foreground">
										{t("characters.charactership.pickEndpoint")}
									</span>
								</>
							)}
						</button>
					}
				/>
				<EndpointPickMenuContent onPickAction={handleAction} />
			</DropdownMenu>
			{character === undefined ? (
				<span className="max-w-full truncate text-xs font-medium">—</span>
			) : null}
			<span className="max-w-full truncate rounded bg-muted/55 px-1 py-0.5 text-tiny text-foreground/90">
				{label.trim().length > 0 ? label : "—"}
			</span>
		</div>
	)
}

function EndpointPickMenuContent(props: {
	readonly onPickAction: (action: string) => void
}) {
	const { onPickAction } = props
	const { t } = useTranslation()
	return (
		<DropdownMenuContent align="center" className="min-w-36">
			<DropdownMenuRadioGroup value="" onValueChange={onPickAction}>
				<DropdownMenuRadioItem value={PICK_ACTION_NAME}>
					{t("characters.charactership.enterName")}
				</DropdownMenuRadioItem>
				<DropdownMenuRadioItem value={PICK_ACTION_CHARACTER}>
					{t("characters.charactership.pickCharacter")}
				</DropdownMenuRadioItem>
			</DropdownMenuRadioGroup>
		</DropdownMenuContent>
	)
}

function EndpointColumn(props: {
	readonly character:
		| Pick<Character, "id" | "name" | "updatedAt" | "imageMeta">
		| undefined
	readonly label: string
	readonly testId: string
}) {
	const { character, label, testId } = props
	const body =
		character !== undefined ? (
			<>
				<CharThumb
					charId={character.id}
					variant="avatar"
					cacheKey={character.updatedAt}
					name={character.name}
					className="aspect-square w-16 rounded-md"
					hoverOverlay={false}
				/>
				<span className="max-w-full truncate text-xs font-medium">
					{character.name}
				</span>
			</>
		) : (
			<>
				<div className="flex aspect-square w-16 items-center justify-center rounded-md border border-dashed bg-muted/20">
					<User className="size-5 text-muted-foreground/60" aria-hidden />
				</div>
				<span className="max-w-full truncate text-xs font-medium">—</span>
			</>
		)

	return (
		<div className="flex w-24 flex-col items-center gap-1">
			{body}
			<span
				className="max-w-full truncate rounded bg-muted/55 px-1 py-0.5 text-tiny text-foreground/90"
				data-testid={`charactership-${testId}-label`}
			>
				{label.trim().length > 0 ? label : "—"}
			</span>
		</div>
	)
}

function ExternalNameColumn(props: {
	readonly name: string
	readonly label: string
}) {
	const { name, label } = props
	return (
		<div className="flex w-24 flex-col items-center gap-1">
			<div className="flex aspect-square w-16 items-center justify-center rounded-md border bg-muted/20 px-1 text-center text-xs font-medium">
				<span className="line-clamp-3">{name}</span>
			</div>
			<span className="max-w-full truncate text-xs font-medium">{name}</span>
			<span className="max-w-full truncate rounded bg-muted/55 px-1 py-0.5 text-tiny text-foreground/90">
				{label.trim().length > 0 ? label : "—"}
			</span>
		</div>
	)
}

function ExternalNameInputColumn(props: {
	readonly name: string
	readonly label: string
	readonly pending?: boolean
	readonly testId?: string
	readonly onChange: (value: string) => void
	readonly onPickAction: (action: string) => void
}) {
	const { name, label, pending, testId, onChange, onPickAction } = props
	const { t } = useTranslation()
	const [open, setOpen] = useState(false)

	function handleAction(action: string) {
		onPickAction(action)
		setOpen(false)
	}

	return (
		<div className="flex w-32 flex-col items-center gap-1.5">
			<div className="flex w-full items-center gap-1">
				<Input
					value={name}
					disabled={pending}
					maxLength={MAX_NAME_LENGTH}
					placeholder={t("characters.charactership.namePlaceholder")}
					onChange={(event) => onChange(event.target.value)}
					size="sm"
					className="flex-1"
					data-testid="charactership-name-input"
					autoFocus
				/>
				<DropdownMenu open={open} onOpenChange={setOpen}>
					<DropdownMenuTrigger
						disabled={pending}
						render={
							<Button
								type="button"
								variant="outline"
								size="icon"
								className="size-8 shrink-0"
								data-testid={
									testId !== undefined ? `${testId}-menu` : undefined
								}
								aria-label={t("characters.charactership.pickEndpoint")}
							>
								<AltArrowDown className="size-3.5" aria-hidden />
							</Button>
						}
					/>
					<EndpointPickMenuContent onPickAction={handleAction} />
				</DropdownMenu>
			</div>
			<span className="max-w-full truncate text-xs font-medium">—</span>
			<span className="max-w-full truncate rounded bg-muted/55 px-1 py-0.5 text-tiny text-foreground/90">
				{label.trim().length > 0 ? label : "—"}
			</span>
		</div>
	)
}

function RowConnector(props: {
	readonly bidirectional?: boolean
	readonly reversed?: boolean
}) {
	const { bidirectional = false, reversed = false } = props
	const uid = useId().replace(/:/g, "")
	const endId = `charactership-arrow-end-${uid}`
	const startId = `charactership-arrow-start-${uid}`

	return (
		<svg
			viewBox="0 0 56 16"
			className={cn(
				"h-4 w-12 shrink-0 text-foreground/55",
				reversed && "scale-x-[-1]",
			)}
			aria-hidden
		>
			<defs>
				<marker
					id={endId}
					markerWidth="7"
					markerHeight="7"
					refX="5.5"
					refY="3.5"
					orient="auto"
					markerUnits="strokeWidth"
				>
					<path
						d="M0.5 0.5 L6 3.5 L0.5 6.5"
						fill="none"
						stroke="currentColor"
						strokeWidth="1.25"
						strokeLinecap="round"
						strokeLinejoin="round"
					/>
				</marker>
				{bidirectional ? (
					<marker
						id={startId}
						markerWidth="7"
						markerHeight="7"
						refX="0.5"
						refY="3.5"
						orient="auto"
						markerUnits="strokeWidth"
					>
						<path
							d="M6.5 0.5 L1 3.5 L6.5 6.5"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.25"
							strokeLinecap="round"
							strokeLinejoin="round"
						/>
					</marker>
				) : null}
			</defs>
			<path
				d="M 4 8 C 18 5.5, 38 10.5, 52 8"
				fill="none"
				stroke="currentColor"
				strokeWidth="1.75"
				strokeLinecap="round"
				markerEnd={`url(#${endId})`}
				markerStart={bidirectional ? `url(#${startId})` : undefined}
			/>
			{bidirectional ? (
				<circle cx="28" cy="8" r="1.25" fill="currentColor" opacity="0.45" />
			) : null}
		</svg>
	)
}
