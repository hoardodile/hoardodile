import type { CatKind, Tag } from "@hoardodile/schemas"
import { GroupLabel } from "@hoardodile/ui/components/group-label"
import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { AddEntityMetaPill } from "@/components/common/AddEntityMetaPill"
import {
	createCategoryMutation,
	invalidateCategories,
	useCategoryList,
	useCategoryStoreStatus,
} from "@/features/cat"
import { createTagMutation, invalidateTags } from "@/features/tags/api"
import { useTagList, useTagStoreStatus } from "@/features/tags/store"
import { TagChip, type TagChipSize } from "@/features/tags/TagChip"
import { collapseTags } from "@/features/tags/utils/collapse"
import {
	filterCategoriesByKind,
	groupTagsByCategory,
} from "@/features/tags/utils/grouping"
import { AddGridPill } from "./AddGridPill"
import { SearchField } from "./SearchField"

export type DualTagPickerProps = {
	readonly value: readonly string[]
	readonly onChange: (ids: readonly string[]) => void
	/** When provided, only categories of this kind are shown. */
	readonly kind?: CatKind
	/** Tag ids that should be visually shown but cannot be toggled. */
	readonly disabledTagIds?: readonly string[]
	/** Tag-chip height tier - `md` in the filterer facets. Category chips
	    always wear the roomier tier. */
	readonly size?: TagChipSize
	/**
	 * Single-select mode: no Selected block or bottom showcase - the
	 * category chips, search and one tag cloud only; clicking a tag
	 * commits `onChange([tagId])` and the caller closes.
	 */
	readonly single?: boolean
	/**
	 * Sibling groups collapse: members render as (and toggle) their
	 * display tag. Rule pickers pass `false` - rules must reference the
	 * real tags, not their display tags.
	 */
	readonly collapseSiblings?: boolean
	/** Test-id prefix for the category chips, search field and tag chips. */
	readonly testId?: string
}

/**
 * Dual tag picker: a wrapping row of category chips; the active category
 * opens inline - no card, the rail is already the surface - with a
 * search-within field and two chip blocks: Selected first, a hairline,
 * then the Available cloud in its own scroll box so hundreds of tags
 * never stretch the rail. All chips are the card's tag surface;
 * selection takes the settings custom active treatment.
 */
export function DualTagPicker(props: DualTagPickerProps) {
	const {
		value,
		onChange,
		kind,
		disabledTagIds,
		size,
		single = false,
		collapseSiblings = true,
		testId,
	} = props
	const { t } = useTranslation()

	const catsStatus = useCategoryStoreStatus()
	const allCategories = useCategoryList()
	const tagsStatus = useTagStoreStatus()
	const allTags = useTagList()

	const categories = filterCategoriesByKind(allCategories, kind)

	// Sibling groups collapse: members render as (and toggle) their
	// display tag, grouped under the display's category.
	const tagsById = useMemo(
		() => new Map(allTags.map((tag) => [tag.id, tag])),
		[allTags],
	)
	const collapsedTags = useMemo(
		() => (collapseSiblings ? collapseTags(allTags, tagsById) : allTags),
		[allTags, tagsById, collapseSiblings],
	)
	const tagsByCategory = groupTagsByCategory(collapsedTags)
	const selectedSet = useMemo(
		() => new Set(value.map((id) => tagsById.get(id)?.displayTagId ?? id)),
		[value, tagsById],
	)

	const [activeCategoryId, setActiveCategoryId] = useState<string | undefined>(
		undefined,
	)
	const [searchQuery, setSearchQuery] = useState("")
	const [createOpen, setCreateOpen] = useState(false)
	const [createCategoryOpen, setCreateCategoryOpen] = useState(false)

	// Single mode always has a category open - the first one by default,
	// like the old category-tab picker.
	const resolvedActiveCategoryId =
		activeCategoryId !== undefined || !single
			? activeCategoryId
			: categories[0]?.id

	const activeCategory =
		resolvedActiveCategoryId !== undefined
			? categories.find((c) => c.id === resolvedActiveCategoryId)
			: undefined

	const tagsForActive: readonly Tag[] =
		activeCategory !== undefined
			? (tagsByCategory.get(activeCategory.id) ?? [])
			: []

	const disabledSet = useMemo(
		() => new Set(disabledTagIds ?? []),
		[disabledTagIds],
	)

	function handleCategoryClick(catId: string) {
		// Single mode never collapses — the category stays open.
		setActiveCategoryId(
			single ? catId : (prev) => (prev === catId ? undefined : catId),
		)
		setSearchQuery("")
	}

	function handleTagToggle(tagId: string) {
		if (disabledSet.has(tagId)) return
		if (selectedSet.has(tagId)) {
			onChange(value.filter((id) => id !== tagId))
		} else {
			onChange([...value, tagId])
		}
	}

	const queryLower = searchQuery.trim().toLowerCase()
	const matches = (name: string) =>
		queryLower.length === 0 || name.toLowerCase().includes(queryLower)

	const selectedTagsForActive = tagsForActive.filter(
		(tag) => selectedSet.has(tag.id) && matches(tag.name),
	)
	const availableTagsForActive = tagsForActive.filter(
		(tag) => !selectedSet.has(tag.id) && matches(tag.name),
	)

	// Bottom showcase: selected tags across every category (collapsed to
	// their display tags, in category order).
	const selectedTagsByCategory = categories
		.map((cat) => ({
			category: cat,
			tags: (tagsByCategory.get(cat.id) ?? []).filter((tag) =>
				selectedSet.has(tag.id),
			),
		}))
		.filter((group) => group.tags.length > 0)

	if (catsStatus === "loading" || tagsStatus === "loading") {
		return (
			<p className="text-xs text-muted-foreground">{t("common.loading")}</p>
		)
	}

	if (categories.length === 0) {
		return (
			<p className="text-xs text-muted-foreground">
				{t("tags.picker.noCategories")}
			</p>
		)
	}

	if (single) {
		return (
			<div className="mt-1 flex flex-col gap-2.5">
				<div className="flex flex-wrap items-center gap-1.5">
					{categories.map((cat) => (
						<TagChip
							key={cat.id}
							color={cat.color}
							size="md"
							active={resolvedActiveCategoryId === cat.id}
							onClick={() => handleCategoryClick(cat.id)}
							data-testid={
								testId !== undefined ? `${testId}-cat-${cat.id}` : undefined
							}
						>
							{cat.name}
						</TagChip>
					))}
				</div>
				{activeCategory !== undefined ? (
					<>
						<SearchField
							value={searchQuery}
							placeholder={t("common.filterCategory", {
								name: activeCategory.name.toLowerCase(),
							})}
							onCommit={setSearchQuery}
							testId={testId !== undefined ? `${testId}-search` : undefined}
						/>
						<div className="strip-scroll flex max-h-56 flex-wrap content-start gap-1.5 overflow-y-auto">
							{tagsForActive
								.filter((tag) => matches(tag.name))
								.map((tag) => (
									<TagChip
										key={tag.id}
										color={tag.color}
										size={size}
										active={selectedSet.has(tag.id)}
										disabled={disabledSet.has(tag.id)}
										onClick={() => onChange([tag.id])}
										data-testid={
											testId !== undefined
												? `${testId}-tag-${tag.id}`
												: undefined
										}
									>
										{tag.name}
									</TagChip>
								))}
						</div>
						{tagsForActive.filter((tag) => matches(tag.name)).length === 0 ? (
							<p className="text-xs text-muted-foreground">
								{t("tags.picker.noMatches")}
							</p>
						) : null}
					</>
				) : null}
			</div>
		)
	}

	return (
		<div className="mt-1 flex flex-col gap-2.5">
			{/* Category chips wear the roomier tier so they read apart from
			    the plain tag chips below; the trailing pill quick-creates a
			    category of the picker's kind. */}
			<div className="flex flex-wrap items-center gap-1.5">
				{categories.map((cat) => (
					<TagChip
						key={cat.id}
						color={cat.color}
						size="md"
						active={resolvedActiveCategoryId === cat.id}
						onClick={() => handleCategoryClick(cat.id)}
					>
						{cat.name}
					</TagChip>
				))}
				<AddGridPill
					label={t("me.custom.entity.category")}
					onClick={() => setCreateCategoryOpen(true)}
					testId={`picker-create-category-${kind}`}
				/>
			</div>
			<AddEntityMetaPill
				open={createCategoryOpen}
				onOpenChange={setCreateCategoryOpen}
				label={t("me.custom.entity.category")}
				dialogTitle={t("categories.dialog.addCategoryTitle")}
				submitLabel={t("me.custom.add")}
				testIdPrefix="picker-create-category"
				nameTestId="picker-create-category-name"
				openButtonTestId={`picker-create-category-${kind}`}
				createButtonTestId="picker-create-category-submit"
				mutationOptions={createCategoryMutation()}
				invalidate={invalidateCategories}
				buildPayload={(meta) => ({
					...meta,
					kind: kind ?? "common",
					color: meta.color || undefined,
				})}
				successMessageKey="categories.panel.toast.added"
				errorMessageKey="categories.panel.toast.addFailed"
			/>

			{activeCategory !== undefined ? (
				<>
					<SearchField
						value={searchQuery}
						placeholder={t("common.filterCategory", {
							name: activeCategory.name.toLowerCase(),
						})}
						onCommit={setSearchQuery}
					/>
					{selectedTagsForActive.length > 0 ? (
						<div>
							<GroupLabel>{t("common.selected")}</GroupLabel>
							<div className="mt-1.5 flex flex-wrap gap-1.5">
								{selectedTagsForActive.map((tag) => (
									<TagChip
										key={tag.id}
										color={tag.color}
										size={size}
										active
										disabled={disabledSet.has(tag.id)}
										onClick={() => handleTagToggle(tag.id)}
									>
										{tag.name}
									</TagChip>
								))}
							</div>
						</div>
					) : null}
					{selectedTagsForActive.length > 0 ? (
						<div className="h-px bg-border" />
					) : null}
					<div>
						<GroupLabel>{t("common.tags")}</GroupLabel>
						<div className="strip-scroll mt-1.5 flex max-h-32 flex-wrap content-start gap-1.5 overflow-y-auto">
							{availableTagsForActive.map((tag) => (
								<TagChip
									key={tag.id}
									color={tag.color}
									size={size}
									disabled={disabledSet.has(tag.id)}
									onClick={() => handleTagToggle(tag.id)}
								>
									{tag.name}
								</TagChip>
							))}
						</div>
					</div>
					{tagsForActive.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							{t("tags.picker.empty")}
						</p>
					) : selectedTagsForActive.length === 0 &&
						availableTagsForActive.length === 0 ? (
						<p className="text-xs text-muted-foreground">
							{t("tags.picker.noMatches")}
						</p>
					) : null}
					{/* Quick-add - the dashed pill at the end of the selection
					    zone creates a tag in the active category on the spot;
					    sm so it matches the plain tag chips. */}
					<AddGridPill
						label={t("me.custom.entity.tag")}
						onClick={() => setCreateOpen(true)}
						size="sm"
						className="mt-1.5"
						testId={`picker-create-tag-${activeCategory.id}`}
					/>
					<AddEntityMetaPill
						open={createOpen}
						onOpenChange={setCreateOpen}
						label={t("me.custom.entity.tag")}
						dialogTitle={t("categories.dialog.addTagTitle")}
						submitLabel={t("me.custom.add")}
						testIdPrefix="picker-create-tag"
						nameTestId="picker-create-tag-name"
						openButtonTestId={`picker-create-tag-${activeCategory.id}`}
						createButtonTestId="picker-create-tag-submit"
						mutationOptions={createTagMutation()}
						invalidate={async (qc) => {
							await invalidateCategories(qc)
							await invalidateTags(qc)
						}}
						buildPayload={(meta) => ({
							...meta,
							catId: activeCategory.id,
						})}
						successMessageKey="categories.panel.toast.added"
						errorMessageKey="categories.panel.toast.addFailed"
					/>
				</>
			) : null}

			{/* Bottom showcase: every selected tag, grouped under its
			    category. Purely a display - clicking a tag only opens that
			    category's picker; the category name is a chip too. */}
			{selectedTagsByCategory.length > 0 ? (
				<>
					<div className="h-px bg-border" />
					<div className="flex flex-col gap-1.5">
						<GroupLabel>{t("common.allSelected")}</GroupLabel>
						{selectedTagsByCategory.map((group) => (
							<div
								key={group.category.id}
								className="flex flex-wrap items-center gap-1.5"
							>
								<TagChip
									color={group.category.color}
									size="md"
									onClick={() => handleCategoryClick(group.category.id)}
								>
									{group.category.name}
								</TagChip>
								<span className="text-secondary-foreground">:</span>
								{group.tags.map((tag) => (
									<TagChip
										key={tag.id}
										color={tag.color}
										size={size}
										active
										onClick={() => handleCategoryClick(group.category.id)}
									>
										{tag.name}
									</TagChip>
								))}
							</div>
						))}
					</div>
				</>
			) : null}
		</div>
	)
}
