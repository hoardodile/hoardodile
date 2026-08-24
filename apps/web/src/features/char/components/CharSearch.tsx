import type { TraitFilter } from "@hoardodile/schemas"
import { MAX_ID_FILTER_SIZE } from "@hoardodile/schemas"
import type { SortBy, SortOrder } from "@hoardodile/shared"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { ListEmptyRow } from "@hoardodile/ui/components/list-empty-row"
import { PaginationBar } from "@hoardodile/ui/components/pagination-bar"
import { toast } from "@hoardodile/ui/components/toast"
import { Tag, TrashBinMinimalistic } from "@hoardodile/ui/icons/registry"
import { pageCountOf } from "@hoardodile/ui/lib/pagination"
import { keepPreviousData, useQuery } from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmByTypingDialog } from "@/components/common/ConfirmByTypingDialog"
import { booleanCodec } from "@/features/prefs"
import { useUsageTimeZones } from "@/features/settings/datePrefs"
import { BulkTagsDialog, type TagFilterMode } from "@/features/tags"
import { type FilterDraft, useFilterDraft } from "@/hooks/useFilterDraft"
import { usePrefSync } from "@/hooks/usePrefSync"
import {
	type SetPatch,
	useLocalPatchState,
	useRouteSearchState,
} from "@/hooks/useRouteSearchState"
import { useToastMutation } from "@/hooks/useToastMutation"
import { prefKeys } from "@/lib/keys"
import {
	CHAR_CARD_TRANSITION,
	navigateWithSharedElement,
} from "@/lib/sharedElementTransition"
import { formatCalendarDay } from "@/lib/timezone"
import { toastBulkOutcome } from "@/lib/toastBulkOutcome"
import {
	CHARACTER_PAGE_SIZE,
	charKeys,
	charListCalendarDay,
	charListCalendarTimeZone,
	charListCardsByIdsQueryOptions,
	charListCardsQueryOptions,
	fetchCharListCards,
	fetchCharListCardsByIds,
	invalidateCharacters,
	softDeleteManyCharactersMutation,
} from "../api"
import { resolveCardSelection } from "../utils/charSearchSelection"
import { CharCard } from "./CharCard"
import { CharCardSkeleton } from "./CharCardSkeleton"
import { CharFilterBar } from "./CharFilterBar"
import {
	CHAR_FILTER_DRAFT_DEFAULTS,
	CHAR_FILTER_DRAFT_KEYS,
	type CharFilterDraft,
	pickCharFilterDraft,
} from "./CharFilterRail"

// â”€â”€ Selection types â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type CharSearchMultiSelection = {
	readonly mode: "multi"
	readonly selected: readonly string[]
	readonly onChange: (ids: readonly string[]) => void
}

export type CharSearchSingleSelection = {
	readonly mode: "single"
	readonly selected: string | undefined
	readonly onChange: (id: string) => void
}

export type CharSearchSelection =
	| CharSearchMultiSelection
	| CharSearchSingleSelection

// â”€â”€ Props â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€â”€

export type CharSearchProps = {
	/**
	 * When provided the picker enters selection mode: cards hide their action
	 * menu, disable in-place navigation, and expose a checkbox / radio in the
	 * bottom-right corner. When `undefined` the picker is a plain browse list.
	 */
	readonly selection?: CharSearchSelection
	/**
	 * Optional controlled browse multi-select. When both are set, the parent
	 * owns the on/off state (e.g. header action on `/characters`). Otherwise
	 * {@link CharSearch} uses internal state and may render a local toggle when
	 * there is no external `selection`.
	 */
	readonly bulkSelectMode?: boolean
	readonly onBulkSelectModeChange?: (on: boolean) => void
	/**
	 * Optional initial search state. When provided the component starts from
	 * these values instead of the default empty search.
	 */
	readonly initialState?: Partial<CharSearchState>
	/**
	 * "panel" (route surface): the facets render into the AppShell's right
	 * rail and stage their edits until applied. "inline" (picker dialogs):
	 * the facets render as an in-page panel that patches live. Defaults to
	 * "inline"; {@link CharSearchRouted} always uses "panel".
	 */
	readonly railPlacement?: "inline" | "panel"
	/**
	 * Browse-mode card open handler: when provided, each card's avatar and
	 * name call it with the card element instead of linking â€” the routed
	 * search wires it to the shared-element card transition.
	 */
	readonly onOpenCard?: (id: string, card: HTMLElement) => void
}

export type CharSearchState = {
	readonly query: string
	readonly page: number
	readonly tagIds: readonly string[]
	readonly tagMode: TagFilterMode
	readonly sortBy: SortBy
	readonly order: SortOrder
	readonly random: boolean
	readonly showOnlySelected: boolean
	readonly trash: boolean
	readonly traitFilters: readonly TraitFilter[]
	readonly searchIntro: boolean
	readonly relationshipTypeIds: readonly string[]
}

export const CHARACTER_SEARCH_DEFAULTS: CharSearchState = {
	query: "",
	page: 1,
	tagIds: [],
	tagMode: "and",
	sortBy: "created",
	order: "desc",
	random: false,
	showOnlySelected: false,
	trash: false,
	traitFilters: [],
	searchIntro: false,
	relationshipTypeIds: [],
}

/**
 * Reusable character search + list UI. Owns search query, tag filters, and
 * pagination state internally via local component state. Used inside dialogs
 * that need to pick one or many characters (relations, resource associations).
 * For the route surface that should mirror filters into the URL, use
 * {@link CharSearchRouted}.
 */
export function CharSearch(props: CharSearchProps) {
	const { initialState } = props
	const [state, patchState] = useLocalPatchState<CharSearchState>({
		...CHARACTER_SEARCH_DEFAULTS,
		...initialState,
	})
	return <CharSearchInner {...props} state={state} patchState={patchState} />
}

/**
 * Route-mounted variant of {@link CharSearch} that persists filter /
 * pagination state in the active route's search params so a hard refresh
 * keeps the same view.
 */
export function CharSearchRouted(props: CharSearchProps) {
	const [state, patchState] = useRouteSearchState<CharSearchState>(
		CHARACTER_SEARCH_DEFAULTS,
	)
	const navigate = useNavigate()
	return (
		<CharSearchInner
			{...props}
			railPlacement="panel"
			state={state}
			patchState={patchState}
			onOpenCard={(id, card) =>
				navigateWithSharedElement(card, CHAR_CARD_TRANSITION, () =>
					navigate({ to: "/characters/$id", params: { id } }),
				)
			}
		/>
	)
}

type CharSearchInnerProps = CharSearchProps & {
	readonly state: CharSearchState
	readonly patchState: SetPatch<CharSearchState>
}

function CharSearchInner(props: CharSearchInnerProps) {
	const {
		selection,
		bulkSelectMode,
		onBulkSelectModeChange,
		railPlacement = "inline",
		state,
		patchState: patchStateInner,
		onOpenCard,
	} = props
	const { t } = useTranslation()
	const { timeZonePref, resolvedTimeZone } = useUsageTimeZones()
	const calendarDay = useMemo(
		() => formatCalendarDay(Date.now(), timeZonePref),
		[timeZonePref, resolvedTimeZone],
	)

	const {
		query,
		page,
		tagIds,
		tagMode,
		sortBy,
		order,
		random,
		showOnlySelected,
		trash,
		traitFilters,
		searchIntro,
		relationshipTypeIds,
	} = state

	const allowInternalBulk = selection === undefined
	const isBulkControlled =
		bulkSelectMode !== undefined && onBulkSelectModeChange !== undefined
	const [internalBulkMode, setInternalBulkMode] = useState(false)
	const bulkSelectOn = isBulkControlled ? bulkSelectMode : internalBulkMode
	const [bulkIds, setBulkIds] = useState<readonly string[]>([])
	const [bulkTagsOpen, setBulkTagsOpen] = useState(false)

	const prevBulkSelectOn = useRef(bulkSelectOn)
	useEffect(() => {
		if (prevBulkSelectOn.current === true && bulkSelectOn === false) {
			setBulkIds([])
			if (showOnlySelected) patchStateInner({ showOnlySelected: false })
		}
		prevBulkSelectOn.current = bulkSelectOn
	}, [bulkSelectOn, showOnlySelected, patchStateInner])

	const patchState = useCallback(
		(partial: Partial<CharSearchState>, opts?: { push?: boolean }) => {
			if (partial.trash !== undefined && partial.trash !== trash) {
				setBulkIds([])
				patchStateInner({ ...partial, showOnlySelected: false }, opts)
				return
			}
			patchStateInner(partial, opts)
		},
		[trash, patchStateInner],
	)

	// Panel placement stages rail edits in a draft and applies them on
	// demand (the rail's Search button, or Enter in the search field).
	const applyDraft = useCallback(
		(draft: CharFilterDraft) => patchState({ ...draft, page: 1 }),
		[patchState],
	)
	const filterDraft = useFilterDraft(
		pickCharFilterDraft(state),
		CHAR_FILTER_DRAFT_KEYS,
		CHAR_FILTER_DRAFT_DEFAULTS,
		applyDraft,
	)

	// "Live search" preference: checked â†’ every filter change applies
	// immediately (the pre-refactor behaviour), unchecked â†’ the staged
	// rail with apply-on-demand. The live mode reuses the FilterDraft
	// interface with a draft that mirrors the applied state and patches
	// straight through, so the rail components need no awareness of it.
	const [liveSearch, setLiveSearch] = usePrefSync(
		prefKeys.searchLive,
		false,
		booleanCodec(),
	)
	const liveFilterDraft = useMemo<FilterDraft<CharFilterDraft>>(
		function buildLiveFilterDraft() {
			return {
				draft: pickCharFilterDraft(state),
				change: (partial) => patchState({ page: 1, ...partial }),
				hasChanges: false,
				apply: () => undefined,
				clear: () => patchState({ ...CHAR_FILTER_DRAFT_DEFAULTS, page: 1 }),
			}
		},
		[state, patchState],
	)

	const externalMulti = useMemo(
		() => (selection?.mode === "multi" ? selection : undefined),
		[selection],
	)
	const internalMulti: CharSearchMultiSelection | undefined = useMemo(
		() =>
			allowInternalBulk && bulkSelectOn
				? {
						mode: "multi",
						selected: bulkIds,
						onChange: setBulkIds,
					}
				: undefined,
		[allowInternalBulk, bulkSelectOn, bulkIds],
	)
	const effectiveMulti = useMemo(
		() => externalMulti ?? internalMulti,
		[externalMulti, internalMulti],
	)
	const effectiveSelection: CharSearchSelection | undefined = useMemo(
		() =>
			effectiveMulti ?? (selection?.mode === "single" ? selection : undefined),
		[effectiveMulti, selection],
	)
	const isMultiSelect = effectiveMulti !== undefined
	const selectedCount = isMultiSelect ? effectiveMulti.selected.length : 0
	// Sorted so the "only selected" list query key is stable across clicks.
	const sortedSelectedIds = useMemo(
		() => [...(effectiveMulti?.selected ?? [])].sort(),
		[effectiveMulti],
	)

	// "Only selected" with an empty selection would match nothing; fall back
	// to the full list instead of showing a confusingly populated page.
	useEffect(() => {
		if (showOnlySelected && selectedCount === 0) {
			patchStateInner({ showOnlySelected: false })
		}
	}, [showOnlySelected, selectedCount, patchStateInner])

	const [softBulkOpen, setSoftBulkOpen] = useState(false)
	const [softBulkTyped, setSoftBulkTyped] = useState("")

	const softManyMut = useToastMutation({
		...softDeleteManyCharactersMutation(),
		invalidate: async (qc, result) => {
			await invalidateCharacters(qc)
			await qc.refetchQueries({ queryKey: charKeys.all, type: "inactive" })
			const okSet = new Set(result.okIds)
			setBulkIds((prev) => prev.filter((id) => !okSet.has(id)))
		},
		errorToastKey: "characters.toast.deleteFailed",
		onSuccess: (result) => {
			setSoftBulkOpen(false)
			setSoftBulkTyped("")
			toastBulkOutcome(t, "characters", result.okIds.length, result.failures)
		},
	})

	function handleBulkSoftDelete() {
		if (bulkIds.length === 0) return
		setSoftBulkOpen(true)
	}

	function handleSoftBulkDialogChange(open: boolean) {
		if (open) return
		setSoftBulkOpen(false)
		setSoftBulkTyped("")
	}

	function setBulkSelectMode(on: boolean) {
		if (isBulkControlled) onBulkSelectModeChange?.(on)
		else setInternalBulkMode(on)
	}

	function handleBulkSelectModeChange(on: boolean) {
		setBulkSelectMode(on)
		if (!on) {
			setBulkIds([])
			if (showOnlySelected) patchStateInner({ showOnlySelected: false })
		}
	}

	const listFilters = {
		query,
		page,
		tagIds,
		tagMode,
		sortBy,
		order,
		random,
		traitFilters,
		searchIntro,
		relationshipTypeIds,
		calendarTimeZone: charListCalendarTimeZone(traitFilters, resolvedTimeZone),
		calendarDay: charListCalendarDay(traitFilters, calendarDay),
	}
	// "Only selected" goes through the byIds mutations so large selections
	// travel in the POST body; everything else stays a plain GET query.
	const plainListOptions = charListCardsQueryOptions({ ...listFilters, trash })
	const byIdsListOptions = charListCardsByIdsQueryOptions({
		...listFilters,
		trash,
		ids: sortedSelectedIds,
	})
	const listQuery = useQuery({
		queryKey: showOnlySelected
			? byIdsListOptions.queryKey
			: plainListOptions.queryKey,
		queryFn: () =>
			showOnlySelected
				? fetchCharListCardsByIds({
						...listFilters,
						trash,
						ids: sortedSelectedIds,
					})
				: fetchCharListCards({ ...listFilters, trash }),
		enabled: !showOnlySelected || sortedSelectedIds.length > 0,
		placeholderData: keepPreviousData,
		staleTime: 2_000,
	})

	const rows = listQuery.data?.rows ?? []
	const total = listQuery.data?.total ?? 0
	const pageCount = pageCountOf(total, CHARACTER_PAGE_SIZE)

	useEffect(() => {
		if (listQuery.isPlaceholderData) return
		if (rows.length === 0 && total > 0) {
			const target = Math.max(1, page - 1)
			if (target !== page) {
				patchState({ page: target }, { push: true })
			}
		}
	}, [listQuery.isPlaceholderData, page, rows.length, total, patchState])

	const showBulkToolbar = allowInternalBulk && bulkSelectOn && !showOnlySelected
	const hasBulkActions = bulkIds.length > 0
	const pageRowIds = rows.map((c) => c.id)
	const pageSelectDisabled = pageRowIds.length === 0

	function handleBulkSelectCurrentPage() {
		if (pageRowIds.length === 0) return
		setBulkIds((prev) => {
			const next = new Set(prev)
			for (const id of pageRowIds) next.add(id)
			return [...next]
		})
	}

	function handleBulkInvertCurrentPage() {
		if (pageRowIds.length === 0) return
		setBulkIds((prev) => {
			const next = new Set(prev)
			for (const id of pageRowIds) {
				if (next.has(id)) next.delete(id)
				else next.add(id)
			}
			return [...next]
		})
	}

	return (
		<div className="flex flex-col">
			<CharFilterBar
				state={state}
				patchState={patchState}
				railPlacement={railPlacement}
				filterDraft={filterDraft}
				liveSearch={liveSearch}
				onLiveSearchChange={setLiveSearch}
				liveFilterDraft={liveFilterDraft}
			/>
			{/* Selection toolbar â€” page-selection tools left (Done first, away
			    from destructive picks), edit actions right. Rendered only
			    while selection tools are active; browsing shows no extra
			    row under the filter bar. */}
			{bulkSelectOn || isMultiSelect ? (
				<div
					className="mt-3 flex flex-wrap items-center gap-2"
					data-testid={bulkSelectOn ? "character-bulk-toolbar" : undefined}
				>
					{bulkSelectOn ? (
						<>
							<Button
								type="button"
								variant="secondary"
								onClick={() => handleBulkSelectModeChange(false)}
								data-testid="character-bulk-done"
							>
								{t("characters.bulk.done")}
							</Button>
							<span className="text-ui text-secondary-foreground">
								{t("characters.bulk.toolbarCount", { count: bulkIds.length })}
							</span>
							<Button
								type="button"
								variant="secondary"
								disabled={pageSelectDisabled}
								onClick={handleBulkSelectCurrentPage}
								data-testid="character-bulk-select-page"
							>
								{t("resources.bulk.selectCurrentPage")}
							</Button>
							<Button
								type="button"
								variant="secondary"
								disabled={pageSelectDisabled}
								onClick={handleBulkInvertCurrentPage}
								data-testid="character-bulk-invert-page"
							>
								{t("resources.bulk.invertCurrentPage")}
							</Button>
							<Button
								type="button"
								variant="secondary"
								disabled={bulkIds.length === 0}
								onClick={() => setBulkIds([])}
								data-testid="character-bulk-clear"
							>
								{t("characters.bulk.clearSelection")}
							</Button>
						</>
					) : null}
					{isMultiSelect ? (
						<Button
							type="button"
							variant="secondary"
							active={showOnlySelected}
							disabled={selectedCount === 0}
							onClick={() => {
								if (!showOnlySelected && selectedCount > MAX_ID_FILTER_SIZE) {
									toast.add({
										title: t("characters.viewSelectedTooMany", {
											max: MAX_ID_FILTER_SIZE,
										}),
										type: "warning",
									})
									return
								}
								patchState({ showOnlySelected: !showOnlySelected })
							}}
							data-testid="character-view-selected"
						>
							{t("characters.viewSelected")}
						</Button>
					) : null}
					{showBulkToolbar && hasBulkActions ? (
						<div className="ml-auto flex flex-wrap gap-2">
							<Button
								type="button"
								variant="secondary"
								onClick={() => setBulkTagsOpen(true)}
								data-testid="character-bulk-edit-tags"
							>
								<Icon icon={Tag} />
								{t("characters.bulk.editTags")}
							</Button>
							{!trash ? (
								<Button
									type="button"
									variant="destructive"
									disabled={softManyMut.isPending}
									onClick={handleBulkSoftDelete}
									data-testid="character-bulk-soft-delete"
								>
									<Icon icon={TrashBinMinimalistic} />
									{t("characters.bulk.moveToTrash")}
								</Button>
							) : null}
						</div>
					) : null}
				</div>
			) : null}

			{pageCount > 1 ? (
				<div className="mt-6">
					<PaginationBar
						page={page}
						pageCount={pageCount}
						onChangePage={(p) => patchState({ page: p }, { push: true })}
						totalLabel={t("characters.search.itemCount", { count: total })}
					/>
				</div>
			) : null}

			<ul
				className="mt-6 flex flex-wrap justify-around gap-4"
				data-testid="character-list"
			>
				{rows.length === 0 ? (
					listQuery.isLoading ? (
						<CharListSkeleton />
					) : (
						<li className="w-full">
							<ListEmptyRow>
								{trash ? t("characters.trashEmpty") : t("characters.listEmpty")}
							</ListEmptyRow>
						</li>
					)
				) : (
					rows.map((c) => (
						<li key={c.id}>
							<CharCard
								character={c}
								selection={resolveCardSelection(effectiveSelection, c.id)}
								onOpenCard={
									onOpenCard !== undefined
										? (card) => onOpenCard(c.id, card)
										: undefined
								}
							/>
						</li>
					))
				)}
			</ul>

			{pageCount > 1 ? (
				<div className="mt-8">
					<PaginationBar
						page={page}
						pageCount={pageCount}
						onChangePage={(p) => patchState({ page: p }, { push: true })}
						totalLabel={t("characters.search.itemCount", { count: total })}
					/>
				</div>
			) : null}
			{showBulkToolbar && hasBulkActions && !trash ? (
				<ConfirmByTypingDialog
					open={softBulkOpen}
					onOpenChange={handleSoftBulkDialogChange}
					title={t("characters.bulk.confirmSoft", { count: bulkIds.length })}
					description={t("characters.bulk.softDeleteDescription")}
					targetName={String(bulkIds.length)}
					expectedInput={String(bulkIds.length)}
					typed={softBulkTyped}
					onTypedChange={setSoftBulkTyped}
					pending={softManyMut.isPending}
					confirmLabel={t("characters.bulk.moveToTrash")}
					pendingLabel={t("common.working")}
					onConfirm={() => softManyMut.mutate(bulkIds)}
					inputTestId="character-bulk-soft-delete-input"
					confirmTestId="character-bulk-soft-delete-confirm"
				/>
			) : null}
			<BulkTagsDialog
				kind="character"
				ids={bulkIds}
				open={bulkTagsOpen}
				onOpenChange={setBulkTagsOpen}
			/>
		</div>
	)
}

function CharListSkeleton() {
	return (
		<>
			{Array.from({ length: 6 }, (_, index) => (
				<li key={index}>
					<CharCardSkeleton />
				</li>
			))}
		</>
	)
}
