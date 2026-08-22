import { Checkbox } from "@hoardodile/ui/components/checkbox"
import {
	FilterRail,
	FilterRailSection,
} from "@hoardodile/ui/components/filter-rail"
import { useTranslation } from "react-i18next"
import { DualTagPicker } from "@/components/common/DualTagPicker"
import { TagFilterModeToggle } from "@/features/tags"
import type { FilterDraft } from "@/hooks/useFilterDraft"
import type { CharSearchState } from "./CharSearch"
import { CharTraitFilter } from "./CharTraitFilter"
import { RelationshipTypeFilterPicker } from "./RelationshipTypeFilterPicker"

/**
 * The staged filter keys of the char search: everything the filter rail
 * edits. Sort/order/page (and "view selected") stay live and are not part
 * of the draft.
 */
export type CharFilterDraft = Pick<
	CharSearchState,
	| "query"
	| "tagIds"
	| "tagMode"
	| "random"
	| "trash"
	| "searchIntro"
	| "traitFilters"
	| "relationshipTypeIds"
>

export const CHAR_FILTER_DRAFT_KEYS: readonly (keyof CharFilterDraft)[] = [
	"query",
	"tagIds",
	"tagMode",
	"random",
	"trash",
	"searchIntro",
	"traitFilters",
	"relationshipTypeIds",
]

export const CHAR_FILTER_DRAFT_DEFAULTS: CharFilterDraft = {
	query: "",
	tagIds: [],
	tagMode: "and",
	random: false,
	trash: false,
	searchIntro: false,
	traitFilters: [],
	relationshipTypeIds: [],
}

/** Pick the draft keys out of a full search state (applied state → draft). */
export function pickCharFilterDraft(state: CharSearchState): CharFilterDraft {
	return Object.fromEntries(
		CHAR_FILTER_DRAFT_KEYS.map((key) => [key, state[key]]),
	) as CharFilterDraft
}

type CharFilterValuesProps = {
	readonly values: CharFilterDraft
	readonly onChange: (partial: Partial<CharFilterDraft>) => void
}

/** The four facet sections, shared by the rail (panel placement) and the
    inline panel (picker dialogs). */
export function CharFilterSections(props: CharFilterValuesProps) {
	const { values, onChange } = props
	const { t } = useTranslation()
	return (
		<>
			<FilterRailSection label={t("characters.search.sectionOptions")}>
				<div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1.5">
					<label
						htmlFor="character-search-intro"
						className="flex items-center gap-2 text-ui text-secondary-foreground"
					>
						<Checkbox
							id="character-search-intro"
							checked={values.searchIntro}
							onCheckedChange={(v) => onChange({ searchIntro: v === true })}
							data-testid="character-search-intro"
						/>
						<span>{t("common.searchIncludeIntro")}</span>
					</label>
					<label
						htmlFor="character-random"
						className="flex items-center gap-2 text-ui text-secondary-foreground"
					>
						<Checkbox
							id="character-random"
							checked={values.random}
							onCheckedChange={(v) => onChange({ random: v === true })}
							data-testid="character-random"
						/>
						<span>{t("characters.sort.random")}</span>
					</label>
					<label
						htmlFor="character-filter-trash"
						className="flex items-center gap-2 text-ui text-secondary-foreground"
					>
						<Checkbox
							id="character-filter-trash"
							checked={values.trash}
							onCheckedChange={(v) => onChange({ trash: v === true })}
							data-testid="character-filter-trash"
						/>
						<span>{t("characters.filter.trash")}</span>
					</label>
				</div>
			</FilterRailSection>

			<FilterRailSection label={t("characters.search.sectionTags")}>
				<div className="mt-1 flex flex-col gap-2.5">
					<TagFilterModeToggle
						mode={values.tagMode}
						onModeChange={(m) => onChange({ tagMode: m })}
					/>
					<div data-testid="character-tag-filter">
						<DualTagPicker
							value={values.tagIds}
							onChange={(ids) => onChange({ tagIds: ids })}
							kind="character"
							size="md"
						/>
					</div>
				</div>
			</FilterRailSection>

			<FilterRailSection label={t("characters.search.sectionTraits")}>
				<div className="mt-1">
					<CharTraitFilter
						value={values.traitFilters}
						onChange={(next) => onChange({ traitFilters: next })}
					/>
				</div>
			</FilterRailSection>

			<FilterRailSection label={t("characters.search.sectionRelations")}>
				<div className="mt-1">
					<RelationshipTypeFilterPicker
						value={values.relationshipTypeIds}
						onChange={(ids) => onChange({ relationshipTypeIds: ids })}
					/>
				</div>
			</FilterRailSection>
		</>
	)
}

type CharFilterRailProps = {
	readonly draft: FilterDraft<CharFilterDraft>
	/** Apply override — the drawer variant also closes itself. */
	readonly onApply?: () => void
	/** Clear-all override — the drawer variant also closes itself. */
	readonly onClearAll?: () => void
	/** When false (live-search mode) the footer apply button is omitted. */
	readonly showApply?: boolean
	/** Live-search toggle row above the apply button (see {@link FilterRail}). */
	readonly liveSearch?: boolean
	readonly onLiveSearchChange?: (live: boolean) => void
	readonly className?: string
}

/** The characters filter rail: rail chrome + the four facet sections,
    driven by the staged draft. */
export function CharFilterRail(props: CharFilterRailProps) {
	const {
		draft,
		onApply,
		onClearAll,
		showApply,
		liveSearch,
		onLiveSearchChange,
		className,
	} = props
	const { t } = useTranslation()
	return (
		<FilterRail
			title={t("characters.filters")}
			clearAllLabel={t("characters.search.clearAll")}
			onClearAll={onClearAll ?? draft.clear}
			resultLabel={t("characters.search.apply")}
			onApply={onApply ?? draft.apply}
			showApply={showApply}
			liveSearch={liveSearch}
			onLiveSearchChange={onLiveSearchChange}
			liveSearchLabel={t("search.liveSearch")}
			className={className}
		>
			<CharFilterSections values={draft.draft} onChange={draft.change} />
		</FilterRail>
	)
}
