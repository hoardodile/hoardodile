import type { SortBy } from "@hoardodile/shared"
import { Button } from "@hoardodile/ui/components/button"
import { CountBadge } from "@hoardodile/ui/components/count-badge"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Icon } from "@hoardodile/ui/components/icon"
import { IconToggle } from "@hoardodile/ui/components/icon-toggle"
import { MobileDrawer } from "@hoardodile/ui/components/mobile-drawer"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { Sort, Widget2, Widget5 } from "@hoardodile/ui/icons/registry"
import { type ReactNode, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { SearchField } from "@/components/common/SearchField"
import { useClaimPanelSlot } from "@/components/layout/panelSlot"
import { ImageSearchButton } from "@/features/search/components/ImageSearchButton"
import type { FilterDraft } from "@/hooks/useFilterDraft"
import {
	RESOURCE_PAGE_SIZE_OPTIONS,
	type ResSearchState,
} from "../utils/searchState"
import {
	pickResFilterDraft,
	type ResFilterDraft,
	ResFilterRail,
	ResFilterSections,
} from "./ResFilterRail"

const SORT_OPTIONS: readonly { tKey: string; value: SortBy }[] = [
	{ tKey: "resources.search.sortCreated", value: "created" },
	{ tKey: "resources.search.sortUpdated", value: "updated" },
	{ tKey: "resources.search.sortDisliked", value: "disliked" },
]

export type ResFilterBarProps = {
	readonly state: ResSearchState
	readonly patchState: (
		partial: Partial<ResSearchState>,
		options?: { push?: boolean },
	) => void
	readonly charId: string | undefined
	/**
	 * "panel": the rail lives in the AppShell's right panel column (desktop)
	 * or a route-owned drawer below the panel breakpoint, and filters are
	 * staged + applied on demand. "inline": an in-page panel that patches
	 * live (used by the picker dialogs).
	 */
	readonly railPlacement?: "inline" | "panel"
	/** Panel mode: the staged filter draft rendered by the rail. */
	readonly filterDraft?: FilterDraft<ResFilterDraft>
	/**
	 * Live search: when true every rail change applies immediately (the
	 * pre-refactor behaviour) instead of staging until Apply.
	 */
	readonly liveSearch?: boolean
	readonly onLiveSearchChange?: (live: boolean) => void
	/** Panel mode: the live-applying draft used while {@link liveSearch}. */
	readonly liveFilterDraft?: FilterDraft<ResFilterDraft>
}

/**
 * Filter controls for {@link ResSearch}. Pure rendering: receives
 * the search state plus a `patchState` writer and emits state updates
 * back through it. In panel placement the facets render into the
 * AppShell's right rail and stage their edits until the apply button is
 * pressed.
 */
export function ResFilterBar(props: ResFilterBarProps) {
	const {
		state,
		patchState,
		charId,
		railPlacement = "inline",
		filterDraft,
		liveSearch,
		onLiveSearchChange,
		liveFilterDraft,
	} = props
	const { t } = useTranslation()
	// Collapsed by default in picker contexts (select dialogs): the filter
	// panel only appears on demand via the Filters toggle.
	const [inlineOpen, setInlineOpen] = useState(false)

	const { query, sortBy, order, random, view, size } = state

	const activeFilterCount = appliedFilterCount(state)
	// The order segmented follows the sort's vocabulary: time sorts take
	// Latest/Earliest, count sorts take Most/Least.
	const orderIsCount = sortBy === "disliked"
	const orderOptions: readonly { value: "desc" | "asc"; label: string }[] =
		orderIsCount
			? [
					{ value: "desc", label: t("resources.search.orderMost") },
					{ value: "asc", label: t("resources.search.orderLeast") },
				]
			: [
					{ value: "desc", label: t("resources.search.orderLatest") },
					{ value: "asc", label: t("resources.search.orderEarliest") },
				]

	const viewToggle = (
		<IconToggle
			value={view}
			onChange={(next) => patchState({ page: 1, view: next })}
			options={[
				{
					value: "grid",
					icon: Widget2,
					label: t("resources.search.viewGrid"),
					testId: "view-toggle-grid",
				},
				{
					value: "masonry",
					icon: Widget5,
					label: t("resources.search.viewMasonry"),
					testId: "view-toggle-masonry",
				},
			]}
		/>
	)

	const sortControls = (
		<>
			<DropdownSelect
				value={sortBy}
				onValueChange={(v) => patchState({ page: 1, sortBy: v as SortBy })}
				disabled={random}
				aria-label={t("resources.search.sortLabel")}
				options={SORT_OPTIONS.map((opt) => ({
					value: opt.value,
					label: t(opt.tKey),
				}))}
			/>
			<PillTabs
				value={random ? "" : order}
				disabled={random}
				onChange={(next) => {
					if (next === "asc" || next === "desc")
						patchState({ page: 1, order: next })
				}}
				items={orderOptions.map((opt) => ({
					value: opt.value,
					label: opt.label,
				}))}
			/>
			<DropdownSelect
				value={String(size)}
				onValueChange={(v) => {
					const next = Number(v)
					if (Number.isFinite(next)) {
						patchState({ page: 1, size: next })
					}
				}}
				data-testid="filter-page-size"
				aria-label={t("resources.search.pageSizeLabel")}
				options={RESOURCE_PAGE_SIZE_OPTIONS.map((n) => ({
					value: String(n),
					label: String(n),
				}))}
			/>
		</>
	)

	if (railPlacement === "panel") {
		if (filterDraft === undefined) {
			throw new Error("ResFilterBar panel placement requires filterDraft")
		}
		return (
			<ResFilterBarPanel
				filterDraft={filterDraft}
				liveFilterDraft={liveFilterDraft}
				liveSearch={liveSearch === true}
				onLiveSearchChange={onLiveSearchChange ?? (() => undefined)}
				charId={charId}
				activeFilterCount={activeFilterCount}
				viewToggle={viewToggle}
				sortControls={sortControls}
			/>
		)
	}

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<div className="min-w-40 flex-1">
					<SearchField
						value={query}
						placeholder={t("resources.search.placeholder")}
						testId="search-input"
						actions={<ImageSearchButton />}
						onCommit={(v) => patchState({ page: 1, query: v })}
					/>
				</div>
				{viewToggle}
				<Button
					type="button"
					variant="secondary"
					active={inlineOpen}
					aria-expanded={inlineOpen}
					onClick={() => setInlineOpen((open) => !open)}
					data-testid="filter-panel-toggle"
				>
					<Icon icon={Sort} />
					{t("resources.search.filters")}
					{activeFilterCount > 0 ? (
						<CountBadge count={activeFilterCount} />
					) : null}
				</Button>
				{sortControls}
			</div>

			{inlineOpen ? (
				<ResFilterSections
					values={pickResFilterDraft(state)}
					onChange={(partial) => patchState({ page: 1, ...partial })}
					charId={charId}
				/>
			) : null}
		</div>
	)
}

type ResFilterBarPanelProps = {
	readonly filterDraft: FilterDraft<ResFilterDraft>
	readonly liveFilterDraft?: FilterDraft<ResFilterDraft>
	readonly liveSearch: boolean
	readonly onLiveSearchChange: (live: boolean) => void
	readonly charId: string | undefined
	readonly activeFilterCount: number
	readonly viewToggle: ReactNode
	readonly sortControls: ReactNode
}

/**
 * Panel placement: the rail renders into the AppShell's right column at
 * and above the panel breakpoint; below it the rail lives in a drawer
 * opened by the Filters button — which is hidden on the wide layout,
 * where the rail is always visible. With live search the rail patches
 * the applied state directly (toggled in the rail's footer) and the
 * Apply button disappears.
 */
function ResFilterBarPanel(props: ResFilterBarPanelProps) {
	const {
		filterDraft,
		liveFilterDraft,
		liveSearch,
		onLiveSearchChange,
		charId,
		activeFilterCount,
		viewToggle,
		sortControls,
	} = props
	const { t } = useTranslation()
	const [drawerOpen, setDrawerOpen] = useState(false)
	const slot = useClaimPanelSlot()
	const effectiveDraft =
		liveSearch && liveFilterDraft !== undefined ? liveFilterDraft : filterDraft

	const rail = (
		<ResFilterRail
			draft={effectiveDraft}
			charId={charId}
			showApply={!liveSearch}
			liveSearch={liveSearch}
			onLiveSearchChange={onLiveSearchChange}
			onApply={() => {
				filterDraft.apply()
				setDrawerOpen(false)
			}}
			onClearAll={() => {
				filterDraft.clear()
				setDrawerOpen(false)
			}}
		/>
	)

	return (
		<div className="flex flex-col gap-3">
			<div className="flex flex-wrap items-center gap-2">
				<div className="min-w-40 flex-1">
					<SearchField
						value={effectiveDraft.draft.query}
						placeholder={t("resources.search.placeholder")}
						testId="search-input"
						actions={<ImageSearchButton />}
						commitOnEnterOnly={!liveSearch}
						onSubmit={(v) => {
							filterDraft.change({ query: v })
							filterDraft.apply()
						}}
						onCommit={(v) => liveFilterDraft?.change({ query: v })}
					/>
				</div>
				{viewToggle}
				<Button
					type="button"
					variant="secondary"
					active={drawerOpen}
					className="min-[1440px]:hidden"
					aria-expanded={drawerOpen}
					onClick={() => setDrawerOpen((open) => !open)}
					data-testid="filter-panel-toggle"
				>
					<Icon icon={Sort} />
					{t("resources.search.filters")}
					{activeFilterCount > 0 ? (
						<CountBadge count={activeFilterCount} />
					) : null}
				</Button>
				{sortControls}
			</div>

			{slot !== null ? createPortal(rail, slot) : null}
			<MobileDrawer
				open={drawerOpen}
				onOpenChange={setDrawerOpen}
				side="right"
				width="w-panel"
				hideAbove="min-[1440px]:hidden"
				className="bg-background"
			>
				{rail}
			</MobileDrawer>
		</div>
	)
}

function appliedFilterCount(state: ResSearchState) {
	let count = 0
	if (state.query !== "") count++
	if (state.tagIds.length > 0) count++
	if (state.charIds.length > 0) count++
	if (state.noCharacters) count++
	if (state.trash) count++
	if (state.random) count++
	if (state.dislikedOnly) count++
	if (state.searchIntro) count++
	if (state.sourceName !== "") count++
	if (state.contentPluginId !== "") count++
	count += Object.keys(state.searchMetaFacets).length
	return count
}
