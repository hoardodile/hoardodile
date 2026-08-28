import type { ResCard as ResCardData } from "@hoardodile/schemas"
import { MAX_ID_FILTER_SIZE } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmByTypingDialog } from "@hoardodile/ui/components/confirm-by-typing-dialog"
import { Icon } from "@hoardodile/ui/components/icon"
import { ListEmptyRow } from "@hoardodile/ui/components/list-empty-row"
import { PaginationBar } from "@hoardodile/ui/components/pagination-bar"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { Spinner } from "@hoardodile/ui/components/spinner"
import { toast } from "@hoardodile/ui/components/toast"
import {
	Download,
	Tag,
	TrashBinMinimalistic,
} from "@hoardodile/ui/icons/registry"
import { pageCountOf } from "@hoardodile/ui/lib/pagination"
import {
	keepPreviousData,
	useInfiniteQuery,
	useQuery,
} from "@tanstack/react-query"
import { useNavigate } from "@tanstack/react-router"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { booleanCodec } from "@/features/prefs"
import { useDatePrefs } from "@/features/settings/datePrefs"
import { BulkTagsDialog } from "@/features/tags"
import { dayjsFor } from "@/features/usage/lib/date"
import { type FilterDraft, useFilterDraft } from "@/hooks/useFilterDraft"
import { usePrefSync } from "@/hooks/usePrefSync"
import {
	type SetPatch,
	useLocalPatchState,
	useRouteSearchState,
} from "@/hooks/useRouteSearchState"
import { useToastMutation } from "@/hooks/useToastMutation"
import { parseFilenameFromContentDisposition } from "@/lib/contentDisposition"
import { prefKeys } from "@/lib/keys"
import { resolveCardSelection } from "@/lib/searchSelection"
import {
	navigateWithSharedElement,
	RES_CARD_TRANSITION,
} from "@/lib/sharedElementTransition"
import { toastBulkOutcome } from "@/lib/toastBulkOutcome"
import {
	bulkDownloadResources,
	fetchResourceListCards,
	fetchResourceListCardsByIds,
	hardDeleteManyResourcesMutation,
	invalidateResources,
	masonryNextPageParam,
	resKeys,
	resListCardsByIdsQueryOptions,
	resListCardsQueryOptions,
	softDeleteManyResourcesMutation,
} from "../api"
import {
	distributeMasonry,
	MASONRY_COLUMN_PX,
	masonryColumnCount,
} from "../utils/masonry"
import type { ResSearchState } from "../utils/searchState"
import { RESOURCE_SEARCH_DEFAULTS } from "../utils/searchState"
import {
	pickResFilterDraft,
	RES_FILTER_DRAFT_DEFAULTS,
	RES_FILTER_DRAFT_KEYS,
	type ResFilterDraft,
} from "./ResFilterRail"

const MAX_BULK_PACK_DOWNLOAD = 150

/**
 * Prefetch horizon: the masonry loads the next page before the user reaches
 * the bottom. The sentinel sits below the columns; expanding the observer's
 * root toward the scroll direction by this much (a fraction of the viewport)
 * makes the next fetch start well ahead of the edge — about 1.5 viewport
 * heights of lead — so scrolling into the new cards never waits on a network
 * round-trip or stalls at the bottom.
 */
const MASONRY_PREFETCH_ROOT_MARGIN = "0px 0px 150% 0px"

import { ResCard } from "./ResCard"
import { ResFilterBar } from "./ResFilterBar"
import { ResSearchPreviewDialog } from "./ResSearchPreviewDialog"

export type ResSearchMultiSelection = {
	readonly mode: "multi"
	readonly selected: readonly string[]
	readonly onChange: (ids: readonly string[]) => void
}

export type ResSearchSingleSelection = {
	readonly mode: "single"
	readonly selected: string | undefined
	readonly onChange: (id: string) => void
}

export type ResSearchSelection =
	| ResSearchMultiSelection
	| ResSearchSingleSelection

type ResSearchProps = {
	/**
	 * When provided the picker enters selection mode: cards hide their action
	 * menu and surface a checkbox / radio overlay. When `undefined` the picker
	 * is a plain browse list.
	 */
	readonly selection?: ResSearchSelection
	/**
	 * When provided, scopes the search to a single character. The character
	 * filter is then hidden from the UI (the picker is treated as a forced,
	 * non-displayed filter), and the "no characters" toggle is suppressed.
	 */
	readonly charId?: string
	/**
	 * Optional controlled browse multi-select. When both are set, the parent
	 * owns the on/off state (e.g. header action on `/resources`). Otherwise
	 * {@link ResSearch} uses internal state and may render a local toggle when
	 * there is no external `selection`.
	 */
	readonly bulkSelectMode?: boolean
	readonly onBulkSelectModeChange?: (on: boolean) => void
	/**
	 * Optional initial search state. When provided the component starts from
	 * these values instead of the default empty search.
	 */
	readonly initialState?: Partial<ResSearchState>
	/**
	 * "panel" (route surface): the facets render into the AppShell's right
	 * rail and stage their edits until applied. "inline" (picker dialogs):
	 * the facets render as an in-page panel that patches live. Defaults to
	 * "inline"; {@link ResSearchRouted} always uses "panel".
	 */
	readonly railPlacement?: "inline" | "panel"
	/**
	 * Browse-mode card open handler: when provided, each card's thumbnail
	 * overlay and name call it with the card element instead of linking â€”
	 * the routed search wires it to the shared-element card transition.
	 */
	readonly onOpenCard?: (id: string, card: HTMLElement) => void
}

/**
 * Reusable resource search & listing experience: search box, tag filter,
 * sort/order/random controls, paginated card grid. Backs state with local
 * component state; use {@link ResSearchRouted} on the route surface where
 * filters should round-trip through the URL.
 */
export function ResSearch(props: ResSearchProps) {
	const { initialState } = props
	const [state, patchState] = useLocalPatchState<ResSearchState>({
		...RESOURCE_SEARCH_DEFAULTS,
		...initialState,
	})
	return <ResSearchInner {...props} state={state} patchState={patchState} />
}

/**
 * Route-mounted variant of {@link ResSearch} that persists filter /
 * pagination state in the active route's search params so refreshes
 * restore the same view.
 */
export function ResSearchRouted(props: ResSearchProps) {
	const [state, patchState] = useRouteSearchState<ResSearchState>(
		RESOURCE_SEARCH_DEFAULTS,
	)
	const navigate = useNavigate()
	return (
		<ResSearchInner
			{...props}
			railPlacement="panel"
			state={state}
			patchState={patchState}
			onOpenCard={(id, card) =>
				navigateWithSharedElement(card, RES_CARD_TRANSITION, () =>
					navigate({ to: "/resources/$id", params: { id } }),
				)
			}
		/>
	)
}

type ResSearchInnerProps = ResSearchProps & {
	readonly state: ResSearchState
	readonly patchState: SetPatch<ResSearchState>
}

function ResSearchInner(props: ResSearchInnerProps) {
	const {
		selection,
		charId,
		bulkSelectMode,
		onBulkSelectModeChange,
		railPlacement = "inline",
		state,
		patchState: patchStateInner,
		onOpenCard,
	} = props
	const { t } = useTranslation()
	const { timeZone } = useDatePrefs()
	const {
		query,
		page,
		size,
		tagIds,
		tagMode,
		noCharacters,
		charIds,
		trash,
		sortBy,
		order,
		random,
		showOnlySelected,
		contentPluginId,
		searchMetaFacets,
		searchIntro,
		sourceName,
		colIds,
		dislikedOnly,
		view,
	} = state

	const [previewId, setPreviewId] = useState("")
	// Masonry infinite scroll: `page` is the fixed position the top pager
	// shows AND the URL page — it is changed only by explicit actions
	// (top-pager jump, filter/view reset to 1). Scrolling to load more never
	// advances `page`, so the URL and the pager stay put. `masonrySession`
	// bumps on every hard reset so the infinite query gets a fresh key instead
	// of reusing previously appended pages.
	const [masonrySession, bumpMasonrySession] = useState(0)
	const masonrySentinelRef = useRef<HTMLDivElement | null>(null)
	// Number of masonry columns: measured from the container so cards always
	// fill the width exactly like the old CSS `columns-[280px]` layout did.
	const [masonryCols, setMasonryCols] = useState(1)
	const masonryContainerRef = useRef<HTMLDivElement | null>(null)
	const handlePreviewRequest = useCallback(
		(resource: ResCardData) => setPreviewId(resource.id),
		[],
	)

	const allowInternalBulk = selection === undefined
	const isBulkControlled =
		bulkSelectMode !== undefined && onBulkSelectModeChange !== undefined
	const [internalBulkMode, setInternalBulkMode] = useState(false)
	const bulkSelectOn = isBulkControlled ? bulkSelectMode : internalBulkMode
	const [bulkIds, setBulkIds] = useState<readonly string[]>([])

	const prevBulkSelectOn = useRef(bulkSelectOn)
	useEffect(() => {
		if (prevBulkSelectOn.current === true && bulkSelectOn === false) {
			setBulkIds([])
			if (showOnlySelected) patchStateInner({ showOnlySelected: false })
		}
		prevBulkSelectOn.current = bulkSelectOn
	}, [bulkSelectOn, showOnlySelected, patchStateInner])

	const patchState = useCallback(
		(partialArg: Partial<ResSearchState>, opts?: { push?: boolean }) => {
			let partial = partialArg
			// Masonry: changing anything that defines the result set (any key
			// other than the page marker) starts a fresh infinite list from
			// page 1. Scroll-driven `page` advances pass through untouched so
			// they append, not reset.
			if (
				view === "masonry" &&
				Object.keys(partial).some((key) => key !== "page")
			) {
				bumpMasonrySession((n) => n + 1)
				partial = { ...partial, page: 1 }
			}
			if (partial.trash !== undefined && partial.trash !== trash) {
				setBulkIds([])
				patchStateInner({ ...partial, showOnlySelected: false }, opts)
				return
			}
			if (
				partial.contentPluginId !== undefined &&
				partial.contentPluginId !== contentPluginId &&
				partial.searchMetaFacets === undefined
			) {
				// Switching plugins invalidates the old plugin's facet picks â€”
				// unless the caller supplies its own facets (the filter rail's
				// apply carries the already-consistent draft facets).
				patchStateInner({ ...partial, searchMetaFacets: {} }, opts)
				return
			}
			patchStateInner(partial, opts)
		},
		[trash, contentPluginId, view, patchStateInner],
	)

	// Masonry top-pager jump: reset the list to the chosen page and continue
	// infinite-loading from it. User-initiated, so it pushes a history entry.
	const jumpToPage = useCallback(
		(page: number) => {
			bumpMasonrySession((n) => n + 1)
			patchState({ page }, { push: true })
		},
		[patchState],
	)

	// Panel placement stages rail edits in a draft and applies them on
	// demand (the rail's Search button, or Enter in the search field).
	const applyDraft = useCallback(
		(draft: ResFilterDraft) => patchState({ ...draft, page: 1 }),
		[patchState],
	)
	const filterDraft = useFilterDraft(
		pickResFilterDraft(state),
		RES_FILTER_DRAFT_KEYS,
		RES_FILTER_DRAFT_DEFAULTS,
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
	const liveFilterDraft = useMemo<FilterDraft<ResFilterDraft>>(
		function buildLiveFilterDraft() {
			return {
				draft: pickResFilterDraft(state),
				change: (partial) => patchState({ page: 1, ...partial }),
				hasChanges: false,
				apply: () => undefined,
				clear: () => patchState({ ...RES_FILTER_DRAFT_DEFAULTS, page: 1 }),
			}
		},
		[state, patchState],
	)

	const externalMulti = useMemo(
		() => (selection?.mode === "multi" ? selection : undefined),
		[selection],
	)
	const internalMulti: ResSearchMultiSelection | undefined = useMemo(
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

	const [hardBulkOpen, setHardBulkOpen] = useState(false)
	const [hardBulkTyped, setHardBulkTyped] = useState("")
	const [softBulkOpen, setSoftBulkOpen] = useState(false)
	const [softBulkTyped, setSoftBulkTyped] = useState("")
	const [bulkDownloadPending, setBulkDownloadPending] = useState(false)
	const [bulkTagsOpen, setBulkTagsOpen] = useState(false)

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

	const softManyMut = useToastMutation({
		...softDeleteManyResourcesMutation(),
		invalidate: async (qc, result) => {
			await invalidateResources(qc)
			await qc.refetchQueries({ queryKey: resKeys.all, type: "inactive" })
			const okSet = new Set(result.okIds)
			setBulkIds((prev) => prev.filter((id) => !okSet.has(id)))
		},
		errorToastKey: "resources.toast.deleteFailed",
		onSuccess: (result) => {
			toastBulkOutcome(t, "resources", result.okIds.length, result.failures)
		},
	})

	const hardManyMut = useToastMutation({
		...hardDeleteManyResourcesMutation(),
		invalidate: async (qc, result) => {
			await invalidateResources(qc)
			await qc.refetchQueries({ queryKey: resKeys.all, type: "inactive" })
			const okSet = new Set(result.okIds)
			setBulkIds((prev) => prev.filter((id) => !okSet.has(id)))
		},
		errorToastKey: "resources.toast.deleteFailed",
		onSuccess: (result) => {
			setHardBulkOpen(false)
			setHardBulkTyped("")
			toastBulkOutcome(t, "resources", result.okIds.length, result.failures)
		},
	})

	async function confirmBulkDownload() {
		if (bulkIds.length === 0) return
		if (bulkIds.length > MAX_BULK_PACK_DOWNLOAD) {
			toast.add({
				title: t("resources.bulk.downloadTooMany", {
					max: MAX_BULK_PACK_DOWNLOAD,
				}),
				type: "error",
			})
			return
		}
		setBulkDownloadPending(true)
		try {
			const res = await bulkDownloadResources(bulkIds, {
				dateStamp: dayjsFor(Date.now(), timeZone).format("YYYY-MM-DD"),
			})
			if (!res.ok) {
				toast.add({
					title:
						res.status === 400
							? t("resources.bulk.downloadRejected")
							: t("resources.bulk.downloadFailed"),
					type: "error",
				})
				return
			}
			const blob = await res.blob()
			const fromHeader = parseFilenameFromContentDisposition(
				res.headers.get("content-disposition"),
			)
			const fallbackDate = dayjsFor(Date.now(), timeZone).format("YYYY-MM-DD")
			const filename = fromHeader ?? `hoardodile-resources-${fallbackDate}.zip`
			const url = URL.createObjectURL(blob)
			const a = document.createElement("a")
			a.href = url
			a.download = filename
			document.body.appendChild(a)
			a.click()
			a.remove()
			URL.revokeObjectURL(url)
		} catch {
			toast.add({ title: t("resources.bulk.downloadFailed"), type: "error" })
		} finally {
			setBulkDownloadPending(false)
		}
	}

	function handleBulkSoftDelete() {
		if (bulkIds.length === 0) return
		setSoftBulkOpen(true)
	}

	function handleSoftBulkDialogChange(open: boolean) {
		if (open) return
		setSoftBulkOpen(false)
		setSoftBulkTyped("")
	}

	function handleHardBulkDialogChange(open: boolean) {
		if (open) return
		setHardBulkOpen(false)
		setHardBulkTyped("")
	}

	// The hidden single-character scope (detail-page links) merges with
	// the rail's character facet into one any-of filter.
	const effectiveCharIds =
		charId === undefined && charIds.length === 0
			? undefined
			: charId !== undefined && !charIds.includes(charId)
				? [charId, ...charIds]
				: [...charIds]

	const listFilters = {
		query,
		page,
		size,
		charIds: effectiveCharIds,
		noCharacters: effectiveCharIds === undefined ? noCharacters : undefined,
		tagIds,
		tagMode,
		sortBy,
		order,
		random,
		contentPluginId: contentPluginId === "" ? undefined : contentPluginId,
		sourceName: sourceName === "" ? undefined : sourceName,
		colIds: colIds.length > 0 ? colIds : undefined,
		searchMetaFacets:
			Object.keys(searchMetaFacets).length > 0 ? searchMetaFacets : undefined,
		searchIntro,
		dislikedOnly,
	}
	// "Only selected" goes through the byIds mutations so large selections
	// travel in the POST body; everything else stays a plain GET query.
	const plainListOptions = resListCardsQueryOptions({ ...listFilters, trash })
	const byIdsListOptions = resListCardsByIdsQueryOptions({
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
				? fetchResourceListCardsByIds({
						...listFilters,
						trash,
						ids: sortedSelectedIds,
					})
				: fetchResourceListCards({ ...listFilters, trash }),
		enabled:
			view === "grid" && (!showOnlySelected || sortedSelectedIds.length > 0),
		placeholderData: view === "grid" ? keepPreviousData : undefined,
		staleTime: 2_000,
	})

	// Masonry infinite list. The key pins the result set + the current
	// `page` (the top-pager position, changed only on explicit resets/jumps)
	// plus a session token so a hard reset never reuses appended pages:
	// `page` never advances on scroll, so the key stays stable and appends
	// stack instead of resetting. `initialPageParam` mirrors `page` so a jump
	// restarts there, and `getNextPageParam` stops at the last page.
	const masonryQuery = useInfiniteQuery({
		queryKey: [
			...resKeys.listCardsInfinite({
				trash,
				...listFilters,
				...(showOnlySelected ? { ids: sortedSelectedIds } : {}),
			}),
			view,
			masonrySession,
		],
		queryFn: ({ pageParam }) =>
			showOnlySelected
				? fetchResourceListCardsByIds({
						...listFilters,
						page: pageParam,
						trash,
						ids: sortedSelectedIds,
					})
				: fetchResourceListCards({ ...listFilters, page: pageParam, trash }),
		initialPageParam: page,
		enabled:
			view === "masonry" && (!showOnlySelected || sortedSelectedIds.length > 0),
		getNextPageParam: masonryNextPageParam,
		// A silent refresh must not drop the pages already accumulated by the
		// user; only an explicit invalidation (a resource mutation / SSE event)
		// resets the list back to the current position page.
		staleTime: Number.POSITIVE_INFINITY,
	})

	const gridRows = listQuery.data?.rows ?? []
	const gridTotal = listQuery.data?.total ?? 0
	const masonryRows =
		view === "masonry"
			? (masonryQuery.data?.pages.flatMap((page) => page.rows) ?? [])
			: []
	const masonryTotal =
		view === "masonry" ? (masonryQuery.data?.pages[0]?.total ?? 0) : 0
	const rows = view === "masonry" ? masonryRows : gridRows
	const total = view === "masonry" ? masonryTotal : gridTotal
	const pageCount = pageCountOf(total, size)

	const masonryIsLoading = view === "masonry" && masonryQuery.isLoading
	const masonryHasNext =
		view === "masonry" && (masonryQuery.hasNextPage ?? false)
	const masonryIsLoadingMore =
		view === "masonry" && masonryQuery.isFetchingNextPage
	// Distribute the accumulated rows across fixed columns. Because
	// `distributeMasonry` is a pure function of `rows` in order, appending
	// never reassigns a card that is already placed — the masonry appends
	// downward instead of rebalancing the columns (fixes the CSS-`columns`
	// reflow that read as "content replaced").
	const masonryColumns =
		view === "masonry" ? distributeMasonry(rows, masonryCols) : []

	// Grid: when a filter overshoots the last page, back off one page.
	useEffect(() => {
		if (view !== "grid") return
		if (listQuery.isPlaceholderData) return
		if (rows.length === 0 && total > 0) {
			const target = Math.max(1, page - 1)
			if (target !== page) {
				patchState({ page: target }, { push: true })
			}
		}
	}, [view, listQuery.isPlaceholderData, page, rows.length, total, patchState])

	// Masonry column count follows the container width (matches the old
	// `columns-[280px]` density) so cards always fill the whole row.
	useEffect(() => {
		if (view !== "masonry") return
		const el = masonryContainerRef.current
		if (el === null) return
		const measure = () => setMasonryCols(masonryColumnCount(el.clientWidth))
		measure()
		const observer = new ResizeObserver(measure)
		observer.observe(el)
		return () => observer.disconnect()
	}, [view])

	// Prefetch before the bottom: observe a sentinel below the columns with a
	// generous root margin, so the next page starts loading while the user is
	// still well above the edge. Re-armed whenever the row count changes so a
	// short first page keeps filling the viewport without a blank gap.
	const masonryFetchingRef = useRef(false)
	masonryFetchingRef.current = masonryQuery.isFetchingNextPage
	useEffect(() => {
		if (view !== "masonry") return
		if (masonryIsLoading || masonryRows.length === 0 || !masonryHasNext) return
		const el = masonrySentinelRef.current
		if (el === null) return
		const observer = new IntersectionObserver(
			(entries) => {
				if (!entries.some((entry) => entry.isIntersecting)) return
				if (masonryFetchingRef.current) return
				void masonryQuery.fetchNextPage()
			},
			{ rootMargin: MASONRY_PREFETCH_ROOT_MARGIN },
		)
		observer.observe(el)
		return () => observer.disconnect()
	}, [
		view,
		masonryIsLoading,
		masonryRows.length,
		masonryHasNext,
		masonrySession,
		masonryQuery.fetchNextPage,
	])

	const hardBulkExpected = String(bulkIds.length)
	const showBulkToolbar = allowInternalBulk && bulkSelectOn && !showOnlySelected
	const hasBulkActions = bulkIds.length > 0
	const pageRowIds = rows.map((r) => r.id)
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
			<ResFilterBar
				state={state}
				patchState={patchState}
				charId={charId}
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
					data-testid={bulkSelectOn ? "resource-bulk-toolbar" : undefined}
				>
					{bulkSelectOn ? (
						<>
							<Button
								type="button"
								variant="secondary"
								onClick={() => handleBulkSelectModeChange(false)}
								data-testid="resource-bulk-done"
							>
								{t("resources.bulk.done")}
							</Button>
							<span className="text-ui text-secondary-foreground">
								{t("resources.bulk.toolbarCount", { count: bulkIds.length })}
							</span>
							<Button
								type="button"
								variant="secondary"
								disabled={pageSelectDisabled}
								onClick={handleBulkSelectCurrentPage}
								data-testid="resource-bulk-select-page"
							>
								{t("resources.bulk.selectCurrentPage")}
							</Button>
							<Button
								type="button"
								variant="secondary"
								disabled={pageSelectDisabled}
								onClick={handleBulkInvertCurrentPage}
								data-testid="resource-bulk-invert-page"
							>
								{t("resources.bulk.invertCurrentPage")}
							</Button>
							<Button
								type="button"
								variant="secondary"
								disabled={bulkIds.length === 0}
								onClick={() => setBulkIds([])}
								data-testid="resource-bulk-clear"
							>
								{t("resources.bulk.clearSelection")}
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
										title: t("resources.viewSelectedTooMany", {
											max: MAX_ID_FILTER_SIZE,
										}),
										type: "warning",
									})
									return
								}
								patchState({ showOnlySelected: !showOnlySelected })
							}}
							data-testid="resource-view-selected"
						>
							{t("resources.viewSelected")}
						</Button>
					) : null}
					{showBulkToolbar && hasBulkActions ? (
						<div className="ml-auto flex flex-wrap gap-2">
							{!trash ? (
								<>
									<Button
										type="button"
										variant="secondary"
										onClick={() => setBulkTagsOpen(true)}
										data-testid="resource-bulk-edit-tags"
									>
										<Icon icon={Tag} />
										{t("resources.bulk.editTags")}
									</Button>
									<Button
										type="button"
										variant="secondary"
										disabled={bulkDownloadPending}
										onClick={() => void confirmBulkDownload()}
										data-testid="resource-bulk-download"
										className="gap-1.5"
									>
										<Icon icon={Download} />
										{t("resources.bulk.download")}
									</Button>
									<Button
										type="button"
										variant="destructive"
										disabled={softManyMut.isPending}
										onClick={handleBulkSoftDelete}
										data-testid="resource-bulk-soft-delete"
									>
										<Icon icon={TrashBinMinimalistic} />
										{t("resources.bulk.moveToTrash")}
									</Button>
								</>
							) : (
								<Button
									type="button"
									variant="destructive"
									disabled={hardManyMut.isPending}
									onClick={() => setHardBulkOpen(true)}
									data-testid="resource-bulk-hard-delete"
								>
									<Icon icon={TrashBinMinimalistic} />
									{t("resources.bulk.deleteForever")}
								</Button>
							)}
						</div>
					) : null}
				</div>
			) : null}

			{pageCount > 1 ? (
				<div className="mt-6">
					<PaginationBar
						page={page}
						pageCount={pageCount}
						onChangePage={
							view === "masonry"
								? jumpToPage
								: (p) => patchState({ page: p }, { push: true })
						}
						totalLabel={t("resources.search.itemCount", { count: total })}
					/>
				</div>
			) : null}

			{view === "grid" ? (
				<ul
					className="mt-6 flex flex-wrap justify-around gap-6"
					data-testid="resource-list"
				>
					{rows.length === 0 ? (
						listQuery.isLoading ? (
							<ResListSkeleton />
						) : (
							<li className="w-full">
								<ListEmptyRow>
									{trash
										? t("resources.search.trashEmpty")
										: t("resources.search.empty")}
								</ListEmptyRow>
							</li>
						)
					) : (
						rows.map((r) => (
							<li key={r.id}>
								<ResCard
									resource={r}
									selection={resolveCardSelection(
										effectiveMulti ?? selection,
										r.id,
									)}
									onPreviewRequest={handlePreviewRequest}
									onOpenCard={
										onOpenCard !== undefined
											? (card) => onOpenCard(r.id, card)
											: undefined
									}
								/>
							</li>
						))
					)}
				</ul>
			) : (
				<>
					<div
						ref={masonryContainerRef}
						className="mt-8 flex items-start gap-6"
						data-testid="resource-list"
					>
						{rows.length === 0 ? (
							<div className="w-full">
								{masonryIsLoading ? (
									<MasonrySkeleton />
								) : (
									<ListEmptyRow>
										{trash
											? t("resources.search.trashEmpty")
											: t("resources.search.empty")}
									</ListEmptyRow>
								)}
							</div>
						) : (
							masonryColumns.map((colCards, columnIndex) => (
								<ul
									key={columnIndex}
									className="flex w-0 flex-1 flex-col gap-6"
								>
									{colCards.map((r) => (
										<li key={r.id} className="flex w-full justify-center">
											<ResCard
												resource={r}
												selection={resolveCardSelection(
													effectiveMulti ?? selection,
													r.id,
												)}
												onPreviewRequest={handlePreviewRequest}
												onOpenCard={
													onOpenCard !== undefined
														? (card) => onOpenCard(r.id, card)
														: undefined
												}
												// Column width caps the cover, the mirror
												// of the pinned strip's fit-height.
												thumbFitWidth={MASONRY_COLUMN_PX}
											/>
										</li>
									))}
								</ul>
							))
						)}
					</div>
					{rows.length > 0 && (masonryHasNext || masonryIsLoadingMore) ? (
						<div
							className="mt-6 flex items-center justify-center gap-2"
							aria-hidden
						>
							{masonryIsLoadingMore ? (
								<Spinner className="size-5 animate-spin text-muted-foreground" />
							) : null}
							<div ref={masonrySentinelRef} className="h-px w-px" />
						</div>
					) : null}
				</>
			)}
			{view === "grid" && pageCount > 1 ? (
				<div className="mt-8">
					<PaginationBar
						page={page}
						pageCount={pageCount}
						onChangePage={(p) => patchState({ page: p }, { push: true })}
						totalLabel={t("resources.search.itemCount", { count: total })}
					/>
				</div>
			) : null}
			<ResSearchPreviewDialog
				rows={rows}
				page={page}
				size={size}
				total={total}
				infinite={view === "masonry"}
				previewId={previewId}
				onChangePreviewId={setPreviewId}
				onChangePage={(p) =>
					patchState(
						{ page: p },
						{ push: view !== "masonry" && previewId === "" },
					)
				}
			/>

			{showBulkToolbar && hasBulkActions && !trash ? (
				<ConfirmByTypingDialog
					open={softBulkOpen}
					onOpenChange={handleSoftBulkDialogChange}
					title={t("resources.bulk.confirmSoft", { count: bulkIds.length })}
					description={t("resources.bulk.softDeleteDescription")}
					targetName={String(bulkIds.length)}
					expectedInput={String(bulkIds.length)}
					typed={softBulkTyped}
					onTypedChange={setSoftBulkTyped}
					pending={softManyMut.isPending}
					confirmLabel={t("resources.bulk.moveToTrash")}
					pendingLabel={t("common.working")}
					onConfirm={() => softManyMut.mutate(bulkIds)}
					inputTestId="resource-bulk-soft-delete-input"
					confirmTestId="resource-bulk-soft-delete-confirm"
				/>
			) : null}
			{showBulkToolbar && hasBulkActions && trash ? (
				<ConfirmByTypingDialog
					open={hardBulkOpen}
					onOpenChange={handleHardBulkDialogChange}
					title={t("resources.bulk.hardDeleteTitle")}
					description={t("resources.bulk.hardDeleteDescription")}
					targetName={String(bulkIds.length)}
					expectedInput={hardBulkExpected}
					typed={hardBulkTyped}
					onTypedChange={setHardBulkTyped}
					pending={hardManyMut.isPending}
					confirmLabel={t("resources.bulk.hardDeleteConfirm")}
					pendingLabel={t("resources.bulk.hardDeleteDeleting")}
					onConfirm={() => hardManyMut.mutate(bulkIds)}
					inputTestId="resource-bulk-hard-delete-input"
					confirmTestId="resource-bulk-hard-delete-confirm"
				/>
			) : null}
			<BulkTagsDialog
				kind="resource"
				ids={bulkIds}
				open={bulkTagsOpen}
				onOpenChange={setBulkTagsOpen}
			/>
		</div>
	)
}

function ResListSkeleton() {
	return (
		<>
			{Array.from({ length: 6 }, (_, index) => (
				<li key={index} className="w-50 shrink-0">
					<div className="flex flex-col gap-1.5">
						<Skeleton className="animate-skel aspect-square rounded-xl" />
						<Skeleton className="animate-skel h-3.5 w-3/4" />
						<div className="flex gap-1.5">
							<Skeleton className="animate-skel h-4.5 w-14 rounded-full" />
							<Skeleton className="animate-skel h-4.5 w-18 rounded-full" />
						</div>
						<div className="flex justify-between">
							<Skeleton className="animate-skel h-2.5 w-14" />
							<Skeleton className="animate-skel h-2.5 w-24" />
						</div>
					</div>
				</li>
			))}
		</>
	)
}

/** Waterfall-form skeleton for the masonry view: variable-height cards in the
    same column layout as the real list, enough of them to fill the screen so
    a load / filter change / refresh never shows a blank gap. */
function MasonrySkeleton() {
	const shapes = [
		"aspect-[3/4]",
		"aspect-square",
		"aspect-[4/3]",
		"aspect-[16/9]",
		"aspect-[3/4]",
		"aspect-[5/4]",
	]
	return (
		<ul
			className="min-h-[calc(100svh-8rem)] columns-[280px] gap-6"
			data-testid="resource-masonry-skeleton"
		>
			{Array.from({ length: 20 }, (_, index) => (
				<li key={index} className="mb-6 break-inside-avoid">
					<div className="flex flex-col gap-1.5">
						<Skeleton
							className={`animate-skel rounded-xl ${shapes[index % shapes.length]}`}
						/>
						<Skeleton className="animate-skel h-3.5 w-3/4" />
						<div className="flex gap-1.5">
							<Skeleton className="animate-skel h-4.5 w-14 rounded-full" />
							<Skeleton className="animate-skel h-4.5 w-18 rounded-full" />
						</div>
						<div className="flex justify-between">
							<Skeleton className="animate-skel h-2.5 w-14" />
							<Skeleton className="animate-skel h-2.5 w-24" />
						</div>
					</div>
				</li>
			))}
		</ul>
	)
}
