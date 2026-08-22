import { Checkbox } from "@hoardodile/ui/components/checkbox"
import {
	FilterRail,
	FilterRailSection,
} from "@hoardodile/ui/components/filter-rail"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { DualChipList } from "@/components/common/DualChipList"
import { DualTagPicker } from "@/components/common/DualTagPicker"
import { CharChipsPicker } from "@/features/char/components/CharChipsPicker"
import { colListQueryOptions } from "@/features/col/api"
import {
	pluginListAllQueryOptions,
	renderSearchKindIcon,
	renderSearchKindLabel,
	resolveManifestName,
} from "@/features/plugin"
import { resSourceNamesQueryOptions } from "@/features/res/api"
import { TagFilterModeToggle } from "@/features/tags"
import type { FilterDraft } from "@/hooks/useFilterDraft"
import type { ResSearchState } from "../utils/searchState"

/**
 * The staged filter keys of the resource search: everything the filter
 * rail edits. Sort/order/page-size/view (and "view selected") stay live
 * and are not part of the draft.
 */
export type ResFilterDraft = Pick<
	ResSearchState,
	| "query"
	| "tagIds"
	| "tagMode"
	| "noCharacters"
	| "charIds"
	| "trash"
	| "random"
	| "searchIntro"
	| "contentPluginId"
	| "searchMetaFacets"
	| "sourceName"
	| "colIds"
	| "dislikedOnly"
>

export const RES_FILTER_DRAFT_KEYS: readonly (keyof ResFilterDraft)[] = [
	"query",
	"tagIds",
	"tagMode",
	"noCharacters",
	"charIds",
	"trash",
	"random",
	"searchIntro",
	"contentPluginId",
	"searchMetaFacets",
	"sourceName",
	"colIds",
	"dislikedOnly",
]

export const RES_FILTER_DRAFT_DEFAULTS: ResFilterDraft = {
	query: "",
	tagIds: [],
	tagMode: "and",
	noCharacters: false,
	charIds: [],
	trash: false,
	random: false,
	searchIntro: false,
	contentPluginId: "",
	searchMetaFacets: {},
	sourceName: "",
	colIds: [],
	dislikedOnly: false,
}

/** Pick the draft keys out of a full search state (applied state → draft). */
export function pickResFilterDraft(state: ResSearchState): ResFilterDraft {
	return Object.fromEntries(
		RES_FILTER_DRAFT_KEYS.map((key) => [key, state[key]]),
	) as ResFilterDraft
}

type ResFilterValuesProps = {
	readonly values: ResFilterDraft
	readonly onChange: (partial: Partial<ResFilterDraft>) => void
	/** Hidden character scope: the "no characters" toggle is suppressed. */
	readonly charId: string | undefined
}

/** The four facet sections, shared by the rail (panel placement) and the
    inline panel (picker dialogs). */
export function ResFilterSections(props: ResFilterValuesProps) {
	const { values, onChange, charId } = props
	const { t, i18n } = useTranslation()
	const pluginListQuery = useQuery(pluginListAllQueryOptions())
	const sourceNamesQuery = useQuery(resSourceNamesQueryOptions())
	const collectionsQuery = useQuery(colListQueryOptions())

	const selectedPluginManifest =
		values.contentPluginId !== "" && values.contentPluginId !== undefined
			? pluginListQuery.data?.find((p) => p.id === values.contentPluginId)
					?.manifest
			: undefined
	const searchMetaKinds = selectedPluginManifest?.ui?.search?.kinds

	return (
		<>
			<FilterRailSection label={t("resources.search.sectionOptions")}>
				<div className="mt-1 grid grid-cols-2 gap-x-2 gap-y-1.5">
					<label
						htmlFor="resource-search-intro"
						className="flex items-center gap-2 text-ui text-secondary-foreground"
					>
						<Checkbox
							id="resource-search-intro"
							checked={values.searchIntro}
							onCheckedChange={(v) => onChange({ searchIntro: v === true })}
							data-testid="resource-search-intro"
						/>
						<span>{t("common.searchIncludeIntro")}</span>
					</label>
					<label
						htmlFor="filter-random"
						className="flex items-center gap-2 text-ui text-secondary-foreground"
					>
						<Checkbox
							id="filter-random"
							checked={values.random}
							onCheckedChange={(v) => onChange({ random: v === true })}
							data-testid="filter-random"
						/>
						<span>{t("resources.search.random")}</span>
					</label>
					{charId === undefined && values.charIds.length === 0 ? (
						<label
							htmlFor="filter-no-characters"
							className="flex items-center gap-2 text-ui text-secondary-foreground"
						>
							<Checkbox
								id="filter-no-characters"
								checked={values.noCharacters}
								onCheckedChange={(v) => onChange({ noCharacters: v === true })}
								data-testid="filter-no-characters"
							/>
							<span>{t("resources.search.noCharacters")}</span>
						</label>
					) : null}
					<label
						htmlFor="filter-disliked"
						className="flex items-center gap-2 text-ui text-secondary-foreground"
					>
						<Checkbox
							id="filter-disliked"
							checked={values.dislikedOnly}
							onCheckedChange={(v) => onChange({ dislikedOnly: v === true })}
							data-testid="filter-disliked"
						/>
						<span>{t("resources.search.dislikedOnly")}</span>
					</label>
					<label
						htmlFor="filter-trash"
						className="flex items-center gap-2 text-ui text-secondary-foreground"
					>
						<Checkbox
							id="filter-trash"
							checked={values.trash}
							onCheckedChange={(v) => onChange({ trash: v === true })}
							data-testid="filter-trash"
						/>
						<span>{t("resources.search.trash")}</span>
					</label>
				</div>
			</FilterRailSection>

			<FilterRailSection label={t("resources.search.sectionTags")}>
				<div className="mt-1 flex flex-col gap-2.5">
					<TagFilterModeToggle
						mode={values.tagMode}
						onModeChange={(m) => onChange({ tagMode: m })}
					/>
					<div data-testid="resource-tag-filter">
						<DualTagPicker
							value={values.tagIds}
							onChange={(ids) => onChange({ tagIds: ids })}
							kind="resource"
						/>
					</div>
				</div>
			</FilterRailSection>

			<FilterRailSection label={t("resources.search.sectionPlugins")}>
				<div className="mt-1">
					<DualChipList
						size="md"
						items={(pluginListQuery.data ?? []).map((p) => ({
							id: p.id,
							label: resolveManifestName(p.manifest, i18n.language),
							selected: values.contentPluginId === p.id,
						}))}
						onToggle={(id) =>
							onChange({
								contentPluginId: values.contentPluginId === id ? "" : id,
							})
						}
						// The search facets belong to the selected plugin, so
						// they sit inside its Selected block.
						selectedExtra={
							searchMetaKinds !== undefined &&
							selectedPluginManifest !== undefined ? (
								<div className="mt-3 flex flex-wrap items-center gap-3 text-ui">
									{searchMetaKinds.map((kind) => {
										const checked = values.searchMetaFacets[kind.key] === true
										const label = renderSearchKindLabel(
											kind,
											selectedPluginManifest,
											values.contentPluginId ?? "",
											i18n.language,
										)
										const kindIcon = renderSearchKindIcon({
											kind,
											manifest: selectedPluginManifest,
											pluginId: values.contentPluginId ?? "",
											locale: i18n.language,
											iconClassName: "h-4 w-4",
										})
										return (
											<label
												key={kind.key}
												htmlFor={`filter-facet-${kind.key}`}
												className="flex items-center gap-2"
											>
												<Checkbox
													id={`filter-facet-${kind.key}`}
													checked={checked}
													onCheckedChange={(v) =>
														onChange({
															searchMetaFacets: toggleFacet(
																values.searchMetaFacets,
																kind.key,
																v === true,
															),
														})
													}
													data-testid={`filter-facet-${kind.key}`}
												/>
												{kindIcon !== undefined ? kindIcon : null}
												<span>{label}</span>
											</label>
										)
									})}
								</div>
							) : undefined
						}
					/>
				</div>
			</FilterRailSection>

			{/* Without any recorded source names the facet is dead weight —
			    hide the whole section, label included. */}
			{(sourceNamesQuery.data ?? []).length > 0 ? (
				<FilterRailSection label={t("resources.search.sectionSource")}>
					<div className="mt-1">
						<DualChipList
							size="md"
							items={(sourceNamesQuery.data ?? []).map(({ name }) => ({
								id: name,
								label: name,
								selected: values.sourceName === name,
							}))}
							onToggle={(name) =>
								onChange({
									sourceName: values.sourceName === name ? "" : name,
								})
							}
						/>
					</div>
				</FilterRailSection>
			) : null}

			{/* Collections facet — same anatomy as Source; hidden entirely
			    when there are no collections to filter by. */}
			{(collectionsQuery.data ?? []).length > 0 ? (
				<FilterRailSection label={t("resources.search.sectionCollections")}>
					<div className="mt-1">
						<DualChipList
							size="md"
							items={(collectionsQuery.data ?? []).map((col) => ({
								id: col.id,
								label: col.name,
								color: col.color,
								selected: values.colIds.includes(col.id),
							}))}
							onToggle={(colId) =>
								onChange({
									colIds: values.colIds.includes(colId)
										? values.colIds.filter((id) => id !== colId)
										: [...values.colIds, colId],
								})
							}
						/>
					</div>
				</FilterRailSection>
			) : null}

			{/* Characters facet — the same chip row + selector dialog the
			    comment composer uses to link characters. */}
			<FilterRailSection label={t("resources.search.sectionCharacters")}>
				<div className="mt-1">
					<CharChipsPicker
						ids={values.charIds}
						onChange={(ids) => onChange({ charIds: ids })}
						testId="filter-characters"
					/>
				</div>
			</FilterRailSection>
		</>
	)
}

type ResFilterRailProps = {
	readonly draft: FilterDraft<ResFilterDraft>
	/** Hidden character scope (see {@link ResFilterSections}). */
	readonly charId: string | undefined
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

/** The resources filter rail: rail chrome + the four facet sections,
    driven by the staged draft. */
export function ResFilterRail(props: ResFilterRailProps) {
	const {
		draft,
		charId,
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
			title={t("resources.search.filters")}
			clearAllLabel={t("resources.search.clearAll")}
			onClearAll={onClearAll ?? draft.clear}
			resultLabel={t("resources.search.apply")}
			onApply={onApply ?? draft.apply}
			showApply={showApply}
			liveSearch={liveSearch}
			onLiveSearchChange={onLiveSearchChange}
			liveSearchLabel={t("search.liveSearch")}
			className={className}
		>
			<ResFilterSections
				values={draft.draft}
				onChange={handleDraftChange(draft)}
				charId={charId}
			/>
		</FilterRail>
	)
}

/** Draft changes mirror the applied-state invariant: switching the plugin
    drops the stale facet picks (they belong to the old plugin). */
function handleDraftChange(
	draft: FilterDraft<ResFilterDraft>,
): (partial: Partial<ResFilterDraft>) => void {
	return (partial) => {
		if (
			partial.contentPluginId !== undefined &&
			partial.contentPluginId !== draft.draft.contentPluginId
		) {
			draft.change({ ...partial, searchMetaFacets: {} })
			return
		}
		draft.change(partial)
	}
}

function toggleFacet(
	current: Record<string, boolean>,
	key: string,
	include: boolean,
): Record<string, boolean> {
	const present = current[key] === true
	if (include === present) return current
	if (include) return { ...current, [key]: true }
	const { [key]: _, ...rest } = current
	return rest
}
