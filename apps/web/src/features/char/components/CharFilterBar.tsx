import type { SortBy } from "@hoardodile/shared"
import { Button } from "@hoardodile/ui/components/button"
import { CountBadge } from "@hoardodile/ui/components/count-badge"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Icon } from "@hoardodile/ui/components/icon"
import { MobileDrawer } from "@hoardodile/ui/components/mobile-drawer"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { Sort } from "@hoardodile/ui/icons/registry"
import { type ReactNode, useState } from "react"
import { createPortal } from "react-dom"
import { useTranslation } from "react-i18next"
import { SearchField } from "@/components/common/SearchField"
import { useClaimPanelSlot } from "@/components/layout/panelSlot"
import type { FilterDraft } from "@/hooks/useFilterDraft"
import { loose } from "@/i18n"
import {
	type CharFilterDraft,
	CharFilterRail,
	CharFilterSections,
	pickCharFilterDraft,
} from "./CharFilterRail"
import type { CharSearchState } from "./CharSearch"

const SORT_OPTIONS: readonly { tKey: string; value: SortBy }[] = [
	{ tKey: "characters.sort.created", value: "created" },
	{ tKey: "characters.sort.updated", value: "updated" },
]

export type CharFilterBarProps = {
	readonly state: CharSearchState
	readonly patchState: (
		partial: Partial<CharSearchState>,
		options?: { push?: boolean },
	) => void
	/**
	 * "panel": the rail lives in the AppShell's right panel column (desktop)
	 * or a route-owned drawer below the panel breakpoint, and filters are
	 * staged + applied on demand. "inline": an in-page panel that patches
	 * live (used by the picker dialogs).
	 */
	readonly railPlacement?: "inline" | "panel"
	/** Panel mode: the staged filter draft rendered by the rail. */
	readonly filterDraft?: FilterDraft<CharFilterDraft>
	/**
	 * Live search: when true every rail change applies immediately (the
	 * pre-refactor behaviour) instead of staging until Apply.
	 */
	readonly liveSearch?: boolean
	readonly onLiveSearchChange?: (live: boolean) => void
	/** Panel mode: the live-applying draft used while {@link liveSearch}. */
	readonly liveFilterDraft?: FilterDraft<CharFilterDraft>
}

/**
 * Filter controls for {@link CharSearch}. Pure rendering: receives the
 * search state plus a `patchState` writer and emits state updates back
 * through it. In panel placement the facets render into the AppShell's
 * right rail and stage their edits until the apply button is pressed.
 */
export function CharFilterBar(props: CharFilterBarProps) {
	const {
		state,
		patchState,
		railPlacement = "inline",
		filterDraft,
		liveSearch,
		onLiveSearchChange,
		liveFilterDraft,
	} = props
	const { t } = useTranslation()

	const { query, sortBy, order, random } = state
	// Collapsed by default in picker contexts (select dialogs): the filter
	// panel only appears on demand via the Filters toggle.
	const [inlineOpen, setInlineOpen] = useState(false)

	const activeFilterCount = appliedFilterCount(state)

	const sortControls = (
		<>
			<DropdownSelect
				value={sortBy}
				onValueChange={(v) => patchState({ page: 1, sortBy: v as SortBy })}
				disabled={random}
				aria-label={t("characters.sortLabel")}
				options={SORT_OPTIONS.map((opt) => ({
					value: opt.value,
					label: loose(t)(opt.tKey),
				}))}
			/>
			<PillTabs
				value={random ? "" : order}
				disabled={random}
				onChange={(next) => {
					if (next === "asc" || next === "desc")
						patchState({ page: 1, order: next })
				}}
				items={(
					[
						{ value: "desc", label: t("characters.sort.latest") },
						{ value: "asc", label: t("characters.sort.earliest") },
					] as const
				).map((opt) => ({
					value: opt.value,
					label: opt.label,
					testId: `character-order-${opt.value}`,
				}))}
			/>
		</>
	)

	if (railPlacement === "panel") {
		if (filterDraft === undefined) {
			throw new Error("CharFilterBar panel placement requires filterDraft")
		}
		return (
			<CharFilterBarPanel
				filterDraft={filterDraft}
				liveFilterDraft={liveFilterDraft}
				liveSearch={liveSearch === true}
				onLiveSearchChange={onLiveSearchChange ?? (() => undefined)}
				activeFilterCount={activeFilterCount}
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
						placeholder={t("characters.searchPlaceholder")}
						testId="character-search-input"
						onCommit={(v) => patchState({ page: 1, query: v })}
					/>
				</div>
				<Button
					type="button"
					variant="secondary"
					active={inlineOpen}
					aria-expanded={inlineOpen}
					onClick={() => setInlineOpen((open) => !open)}
					data-testid="character-filter-panel-toggle"
				>
					<Icon icon={Sort} />
					{t("characters.filters")}
					{activeFilterCount > 0 ? (
						<CountBadge count={activeFilterCount} />
					) : null}
				</Button>
				{sortControls}
			</div>

			{inlineOpen ? (
				<CharFilterSections
					values={pickCharFilterDraft(state)}
					onChange={(partial) => patchState({ page: 1, ...partial })}
				/>
			) : null}
		</div>
	)
}

type CharFilterBarPanelProps = {
	readonly filterDraft: FilterDraft<CharFilterDraft>
	readonly liveFilterDraft?: FilterDraft<CharFilterDraft>
	readonly liveSearch: boolean
	readonly onLiveSearchChange: (live: boolean) => void
	readonly activeFilterCount: number
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
function CharFilterBarPanel(props: CharFilterBarPanelProps) {
	const {
		filterDraft,
		liveFilterDraft,
		liveSearch,
		onLiveSearchChange,
		activeFilterCount,
		sortControls,
	} = props
	const { t } = useTranslation()
	const [drawerOpen, setDrawerOpen] = useState(false)
	const slot = useClaimPanelSlot()
	const effectiveDraft =
		liveSearch && liveFilterDraft !== undefined ? liveFilterDraft : filterDraft

	const rail = (
		<CharFilterRail
			draft={effectiveDraft}
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
						placeholder={t("characters.searchPlaceholder")}
						testId="character-search-input"
						commitOnEnterOnly={!liveSearch}
						onSubmit={(v) => {
							filterDraft.change({ query: v })
							filterDraft.apply()
						}}
						onCommit={(v) => liveFilterDraft?.change({ query: v })}
					/>
				</div>
				<Button
					type="button"
					variant="secondary"
					active={drawerOpen}
					className="min-[1440px]:hidden"
					aria-expanded={drawerOpen}
					onClick={() => setDrawerOpen((open) => !open)}
					data-testid="character-filter-panel-toggle"
				>
					<Icon icon={Sort} />
					{t("characters.filters")}
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

function appliedFilterCount(state: CharSearchState) {
	let count = 0
	if (state.query !== "") count++
	if (state.tagIds.length > 0) count++
	if (state.random) count++
	if (state.trash) count++
	if (state.searchIntro) count++
	count += state.traitFilters.length
	count += state.relationshipTypeIds.length
	return count
}
