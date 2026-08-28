import { useSortable } from "@dnd-kit/sortable"
import { CSS } from "@dnd-kit/utilities"
import type { Category, CatKind } from "@hoardodile/schemas"
import { MAX_SEARCH_QUERY_LENGTH } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import {
	DropdownMenuItem,
	DropdownMenuSeparator,
} from "@hoardodile/ui/components/dropdown-menu"
import { Icon } from "@hoardodile/ui/components/icon"
import { ManagementEmpty } from "@hoardodile/ui/components/management-empty"
import { PanelToolbar } from "@hoardodile/ui/components/panel-toolbar"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import { SortableChipList } from "@hoardodile/ui/components/sortable-chip-list"
import { toast } from "@hoardodile/ui/components/toast"
import { Add } from "@hoardodile/ui/icons/actions"
import {
	BranchingPathsUp,
	Copy,
	HamburgerMenu,
	MoveToFolder,
	Pen,
	Pin,
	TrashBinMinimalistic,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { useQuery } from "@tanstack/react-query"
import { forwardRef, useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AddEntityMetaPill } from "@/components/common/AddEntityMetaPill"
import {
	DeleteEntityButton,
	type DeleteEntityButtonHandle,
} from "@/components/common/DeleteEntityButton"
import { EntityCard, Meta } from "@/components/common/EntityCard"
import { EntityMetaEditDialog } from "@/components/common/EntityMetaEditDialog"
import { matchesNameQuery } from "@/components/common/entityFilter"
import {
	catListWithCountsQueryOptions,
	createCategoryMutation,
	deleteCategoryMutation,
	forceDeleteCategoryMutation,
	invalidateCategories,
	reorderCategoryMutation,
	updateCategoryMutation,
} from "@/features/cat"
import { CategoryRailGroup } from "@/features/cat/CategoryRailGroup"
import { MoveTagDialog } from "@/features/cat/MoveTagDialog"
import {
	createTagMutation,
	deleteTagMutation,
	forceDeleteTagMutation,
	reorderTagMutation,
	siblingGroupsQueryOptions,
	TagChip,
	type TagSiblingGroup,
	tagListWithCountsQueryOptions,
} from "@/features/tags"
import { MergeTagsDialog } from "@/features/tags/MergeTagsDialog"
import { TagChipHover } from "@/features/tags/TagChipHover"
import { TagImageMenuButton } from "@/features/tags/TagImageMenuButton"
import { useDeleteMutation } from "@/hooks/useDeleteMutation"
import { useReorderMutation } from "@/hooks/useReorderMutation"
import { i18n } from "@/i18n"
import {
	buildEntityMetaUpdatePayload,
	entityMetaFromEntity,
} from "@/lib/entityMetaDraft"
import { sortEntityMetas } from "@/lib/sortEntityMetas"
import {
	CATEGORY_KIND_TABS,
	type CatWithCounts,
	groupTagsByCategoryWithCounts,
	isCategoryKind,
	type TagWithCounts,
	tagHasNoCharOrResUsage,
} from "./panelModel"
import { invalidateCategoriesAndTags, useCategoryOptions } from "./panelShared"
import { TagEditDialog } from "./TagEditDialog"
import { effectiveTagCounts, tagRowLabel } from "./utils/tagRowLabel"

const KIND_TABS = CATEGORY_KIND_TABS

/**
 * Sibling groups by member tag id: lets rows know whether a tag renders
 * as another tag (badge) and what its group's union counts are.
 */
function useSiblingGroupMap(): ReadonlyMap<string, TagSiblingGroup> {
	const q = useQuery(siblingGroupsQueryOptions())
	return useMemo(() => {
		const map = new Map<string, TagSiblingGroup>()
		for (const group of q.data ?? []) {
			for (const id of group.memberTagIds) map.set(id, group)
		}
		return map
	}, [q.data])
}

/** A tag is unused when nothing uses it — a display tag reports its
    group's union counts. Sibling members are never "unused". */
function isTagUnused(
	tag: TagWithCounts,
	group: TagSiblingGroup | undefined,
): boolean {
	if (tag.displayTagId !== tag.id) return false
	return tagHasNoCharOrResUsage(effectiveTagCounts(tag, group))
}

/**
 * Combined management UI for categories and their tags — the custom
 * page's Tags tab: a kind filter over a master-detail pair — the
 * category rail on the left (chip + chevron menu per category, "New
 * category" at the foot), the selected category's tags as a grid of
 * entity cards with a toolbar (filter, unused triage, reorder, add).
 */
export function CatsAndTagsPanel() {
	const { t } = useTranslation()
	const catsQ = useQuery(catListWithCountsQueryOptions())
	const tagsQ = useQuery(tagListWithCountsQueryOptions())
	const groups = useSiblingGroupMap()

	const [activeKind, setActiveKind] = useState<CatKind>("common")
	const [selectedCatId, setSelectedCatId] = useState<string | undefined>(
		undefined,
	)
	const [reorderMode, setReorderMode] = useState(false)
	const [tagSearchQuery, setTagSearchQuery] = useState("")
	const [unusedOnly, setUnusedOnly] = useState(false)
	const [addTagOpen, setAddTagOpen] = useState(false)
	const [addCategoryOpen, setAddCategoryOpen] = useState(false)
	const loading = catsQ.isLoading || tagsQ.isLoading

	const allCategories = catsQ.data ?? []
	const tags = tagsQ.data ?? []
	const categories = allCategories.filter((c) => c.kind === activeKind)
	const grouped = groupTagsByCategoryWithCounts(tags)

	const {
		orderIds: categoryOrderIds,
		setOrderIds: setCategoryOrderIds,
		reorderMut: catReorderMut,
		sensors: catSensors,
		handleDragEnd: handleCategoryDragEnd,
	} = useReorderMutation({
		mutationOptions: reorderCategoryMutation(),
		invalidate: invalidateCategories,
		buildInput: (ids) => ({ kind: activeKind, ids }),
	})

	useEffect(() => {
		setCategoryOrderIds(undefined)
	}, [activeKind, setCategoryOrderIds])

	const sortableCategories = sortEntityMetas(categories, categoryOrderIds)

	// The master-detail always has a selection: the first category of the
	// active kind is the default, clicking the rail picks another.
	const activeExists =
		selectedCatId !== undefined &&
		sortableCategories.some((c) => c.id === selectedCatId)
	const effectiveSelected =
		(activeExists
			? sortableCategories.find((c) => c.id === selectedCatId)
			: undefined) ?? sortableCategories[0]

	const {
		orderIds: tagOrderIds,
		setOrderIds: setTagOrderIds,
		reorderMut: tagReorderMut,
		sensors: tagSensors,
		handleDragEnd: handleTagDragEnd,
	} = useReorderMutation({
		mutationOptions: reorderTagMutation(),
		invalidate: invalidateCategoriesAndTags,
		buildInput: (ids) => ({ catId: effectiveSelected?.id ?? "", ids }),
	})

	useEffect(() => {
		setTagOrderIds(undefined)
	}, [effectiveSelected?.id, setTagOrderIds])

	const allTags =
		effectiveSelected !== undefined
			? (grouped.get(effectiveSelected.id) ?? [])
			: []
	const unusedCount = allTags.filter((tag) =>
		isTagUnused(tag, groups.get(tag.id)),
	).length
	const filteredTags = allTags.filter(
		(tag) =>
			matchesNameQuery(tag.name, tagSearchQuery) &&
			(!unusedOnly || isTagUnused(tag, groups.get(tag.id))),
	)
	const orderedTags = sortEntityMetas(filteredTags, tagOrderIds)

	function handleKindChange(next: string) {
		if (!isCategoryKind(next)) return
		setActiveKind(next)
		setSelectedCatId(undefined)
		setTagSearchQuery("")
		setUnusedOnly(false)
	}

	return (
		<div className="flex flex-col gap-4">
			{/* Kind filter — full width above the grid; three segments would
			    overflow the 200px rail. */}
			<PillTabs
				value={activeKind}
				onChange={handleKindChange}
				className="self-start"
				items={KIND_TABS.map((k) => ({
					value: k,
					label: t(`categories.panel.kindTab.${k}`),
					testId: `category-kind-tab-${k}`,
				}))}
			/>

			{loading ? <CatsPanelSkeleton /> : null}

			{!loading && allCategories.length === 0 && tags.length === 0 ? (
				<ManagementEmpty data-testid="categories-tags-empty">
					{t("categories.panel.empty")}
				</ManagementEmpty>
			) : null}

			{!loading ? (
				<div className="grid grid-cols-1 gap-8 lg:grid-cols-[200px_1fr]">
					{/* Category rail — one group row per category: the chip (its
					    own tint, the count, the pin) glued to a chevron whose
					    menu carries edit/delete. The rail scrolls independently
					    up to the tags column's max height; the add button sits
					    outside the scroll, grouped with the list (no min-height
					    gap when there are only one or two categories). */}
					<div className="flex min-w-0 flex-col gap-1">
						<div className="strip-scroll flex max-h-[420px] flex-col overflow-y-auto">
							<SortableChipList
								items={sortableCategories}
								renderItem={(category) => (
									<SortableRailRow
										key={category.id}
										category={category}
										selected={effectiveSelected?.id === category.id}
										reorderMode={reorderMode}
										dragDisabled={!reorderMode || catReorderMut.isPending}
										onSelect={() => {
											setSelectedCatId(category.id)
											setUnusedOnly(false)
										}}
									/>
								)}
								sensors={catSensors}
								onDragEnd={handleCategoryDragEnd(sortableCategories)}
								listClassName="flex w-full flex-col gap-1"
							/>
						</div>
						<Button
							variant="secondary"
							onClick={() => setAddCategoryOpen(true)}
							className="w-full justify-center"
							data-testid="open-add-category-dialog"
						>
							<Icon icon={Add} />
							{t("me.custom.entity.category")}
						</Button>
					</div>

					{/* Selected category's tags — each a bordered entity card:
					    the chip as a style preview plus the management extras. */}
					<div className="min-w-0">
						<PanelToolbar
							placeholder={t("me.custom.filterTagsIn", {
								category: effectiveSelected?.name ?? "",
							})}
							query={tagSearchQuery}
							onQuery={setTagSearchQuery}
							maxLength={MAX_SEARCH_QUERY_LENGTH}
							reorder={reorderMode}
							onToggleReorder={() => setReorderMode((value) => !value)}
							unusedCount={unusedCount}
							unusedOnly={unusedOnly}
							onToggleUnused={() => setUnusedOnly((value) => !value)}
							onAdd={() => setAddTagOpen(true)}
							addLabel={t("me.custom.entity.tag")}
							testIds={{
								filter: "cats-and-tags-search",
								unused: "categories-unused-filter",
								reorder: "categories-reorder-mode",
								add: `open-add-tag-dialog-${effectiveSelected?.id ?? ""}`,
							}}
						/>
						<SortableChipList
							items={orderedTags}
							renderItem={(tag) => (
								<TagCard
									key={tag.id}
									tag={tag}
									kind={effectiveSelected?.kind ?? "common"}
									reorderMode={reorderMode}
									dragDisabled={!reorderMode || tagReorderMut.isPending}
								/>
							)}
							sensors={tagSensors}
							onDragEnd={handleTagDragEnd(orderedTags)}
							listClassName="strip-scroll mt-3 grid min-h-40 max-h-[420px] grid-cols-2 gap-2 overflow-y-auto lg:grid-cols-3"
						/>
						<p className="mt-2 text-tiny text-muted-foreground">
							{t("me.custom.tagsOf", {
								shown: filteredTags.length,
								total: allTags.length,
							})}
							{unusedCount > 0
								? ` · ${t("me.custom.unusedCount", { count: unusedCount })}`
								: ""}
						</p>
					</div>
				</div>
			) : null}

			{effectiveSelected !== undefined ? (
				<AddTagDialog
					open={addTagOpen}
					onOpenChange={setAddTagOpen}
					catId={effectiveSelected.id}
				/>
			) : null}
			<AddCategoryDialog
				open={addCategoryOpen}
				onOpenChange={setAddCategoryOpen}
				kind={activeKind}
			/>
		</div>
	)
}

/** One category rail row — the chip glued to its chevron menu; sortable
    in reorder mode (the rail keeps the per-kind category order). */
function SortableRailRow(props: {
	readonly category: CatWithCounts
	readonly selected: boolean
	readonly reorderMode: boolean
	readonly dragDisabled: boolean
	readonly onSelect: () => void
}) {
	const { category, selected, reorderMode, dragDisabled, onSelect } = props
	const { t } = useTranslation()
	const [menuOpen, setMenuOpen] = useState(false)
	const [editOpen, setEditOpen] = useState(false)
	const deleteRef = useRef<DeleteEntityButtonHandle>(null)
	const unused = category.tagCount === 0

	const {
		attributes,
		listeners,
		setNodeRef,
		transform,
		transition,
		isDragging,
	} = useSortable({
		id: category.id,
		disabled: dragDisabled,
		transition: null,
	})

	const style: React.CSSProperties = {
		transform: CSS.Translate.toString(transform),
		transition,
		opacity: isDragging ? 0.5 : 1,
	}

	return (
		<div
			ref={setNodeRef}
			style={style}
			className={cn(
				"flex w-full items-center",
				reorderMode && !dragDisabled && "cursor-grab active:cursor-grabbing",
			)}
			data-testid={`category-row-${category.id}`}
			{...attributes}
			{...listeners}
		>
			{reorderMode ? (
				<Icon
					icon={HamburgerMenu}
					size="sm"
					className="mr-1 shrink-0 cursor-grab text-muted-foreground"
				/>
			) : null}
			<CategoryRailGroup
				label={category.name}
				color={category.color}
				count={category.tagCount}
				pinned={category.pinned}
				active={selected}
				warning={unused}
				onSelect={onSelect}
				menuLabel={t("me.custom.more")}
				menuOpen={menuOpen}
				onMenuOpenChange={setMenuOpen}
				menuItems={
					<>
						<DropdownMenuItem
							onClick={() => setEditOpen(true)}
							data-testid={`category-open-edit-${category.id}`}
						>
							<Icon icon={Pen} />
							{t("common.edit")}
						</DropdownMenuItem>
						<DropdownMenuSeparator />
						<DropdownMenuItem
							variant="destructive"
							onClick={() => deleteRef.current?.beginDelete()}
							data-testid={`category-delete-menu-${category.id}`}
						>
							<Icon icon={TrashBinMinimalistic} />
							{t("deleteEntity.defaultLabel")}
						</DropdownMenuItem>
					</>
				}
				chipTestId={`category-tab-${category.id}`}
				className="min-w-0 flex-1"
			/>
			{editOpen ? (
				<CategoryEditDialog
					category={category}
					open={editOpen}
					onOpenChange={setEditOpen}
				/>
			) : null}
			<CategoryDeleteButton ref={deleteRef} category={category} hideTrigger />
		</div>
	)
}

/** One tag card — the chip preview plus the More menu (edit, copy, move,
    merge, delete) and the usage caption. */
function TagCard(props: {
	readonly tag: TagWithCounts
	readonly kind: CatKind
	readonly reorderMode: boolean
	readonly dragDisabled: boolean
}) {
	const { tag, kind, reorderMode, dragDisabled } = props
	const { t } = useTranslation()
	const [moveOpen, setMoveOpen] = useState(false)
	const [mergeOpen, setMergeOpen] = useState(false)
	const groups = useSiblingGroupMap()
	const group = groups.get(tag.id)
	const tagsQ = useQuery(tagListWithCountsQueryOptions())
	const displayName =
		tagsQ.data?.find((td) => td.id === tag.displayTagId)?.name ?? tag.name
	const isMember = tag.displayTagId !== tag.id
	const label = tagRowLabel(tag, kind, group, displayName, t)
	const effective = effectiveTagCounts(tag, group)
	const unused = !isMember && tagHasNoCharOrResUsage(effective)

	function handleCopy() {
		void navigator.clipboard.writeText(tag.name).then(
			() => {
				toast.add({
					title: t("categories.panel.toast.copied"),
					type: "success",
				})
			},
			() => {
				toast.add({
					title: t("categories.panel.toast.copyFailed"),
					type: "error",
				})
			},
		)
	}

	return (
		<>
			<EntityCard
				item={tag}
				reorderMode={reorderMode}
				dragDisabled={dragDisabled}
				testIdPrefix="tag"
				triggerTestId={`tag-chip-${tag.id}`}
				chip={
					<div className="flex min-w-0 items-center gap-1">
						<TagChipHover tagId={tag.id}>
							<TagChip
								title={
									(tag.link?.length ?? 0) === 0 &&
									tag.imageMeta === undefined &&
									tag.intro.trim() === ""
										? tag.name
										: undefined
								}
								color={tag.color}
								border={unused ? "dashed" : undefined}
								icon={
									tag.pinned ? (
										<Pin className="inline size-3" aria-hidden />
									) : undefined
								}
								className="max-w-full"
							>
								{label.name}
							</TagChip>
						</TagChipHover>
						<TagImageMenuButton
							tagId={tag.id}
							tagName={tag.name}
							imageMeta={tag.imageMeta}
							updatedAt={tag.updatedAt}
							className="shrink-0"
						/>
					</div>
				}
				meta={
					unused ? (
						<Meta text={t("me.custom.unused")} />
					) : isMember ? null : (
						<Meta text={label.suffix?.trim() ?? ""} />
					)
				}
				extraMenuItems={
					<>
						<DropdownMenuItem
							onClick={handleCopy}
							data-testid={`tag-copy-${tag.id}`}
						>
							<Icon icon={Copy} />
							{t("categories.panel.copyTagName")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => setMoveOpen(true)}
							data-testid={`tag-move-${tag.id}`}
						>
							<Icon icon={MoveToFolder} />
							{t("me.custom.moveTag")}
						</DropdownMenuItem>
						<DropdownMenuItem
							onClick={() => setMergeOpen(true)}
							data-testid={`tag-merge-menu-${tag.id}`}
						>
							<Icon icon={BranchingPathsUp} />
							{t("categories.panel.mergeTagMenu")}
						</DropdownMenuItem>
					</>
				}
				renderEditDialog={({ open, onOpenChange }) => (
					<TagEditDialog tag={tag} open={open} onOpenChange={onOpenChange} />
				)}
				renderDeleteButton={(ref) => (
					<TagDeleteButton ref={ref} tag={tag} hideTrigger />
				)}
			/>
			{moveOpen ? (
				<MoveTagDialog tag={tag} open={moveOpen} onOpenChange={setMoveOpen} />
			) : null}
			{mergeOpen ? (
				<MergeTagsDialog
					source={tag}
					open={mergeOpen}
					onOpenChange={setMergeOpen}
				/>
			) : null}
		</>
	)
}

const CategoryDeleteButton = forwardRef<
	DeleteEntityButtonHandle,
	{
		readonly category: CatWithCounts
		readonly compactIcon?: boolean
		readonly hideTrigger?: boolean
	}
>(function CategoryDeleteButton(
	{ category, compactIcon = false, hideTrigger = false },
	ref,
) {
	const { t } = useTranslation()
	const { handleDelete, handleForceDelete } = useDeleteMutation({
		deleteOptions: deleteCategoryMutation(),
		forceDeleteOptions: forceDeleteCategoryMutation(),
		invalidate: invalidateCategoriesAndTags,
	})

	return (
		<DeleteEntityButton
			ref={ref}
			entityKindLabel={t("categories.delete.kindLabelCategory")}
			entityName={category.name}
			testId={`category-delete-${category.id}`}
			usageCount={category.tagCount}
			usageLabel={t("categories.delete.usageLabelTags")}
			usageLabelOne={t("categories.delete.usageLabelTagsOne")}
			onDelete={() => handleDelete(category.id)}
			onForceDelete={(typed) => handleForceDelete(category.id, typed)}
			compactIcon={hideTrigger ? false : compactIcon}
			hideTrigger={hideTrigger}
		/>
	)
})

const TagDeleteButton = forwardRef<
	DeleteEntityButtonHandle,
	{
		readonly tag: TagWithCounts
		readonly compactIcon?: boolean
		readonly hideTrigger?: boolean
	}
>(function TagDeleteButton(
	{ tag, compactIcon = false, hideTrigger = false },
	ref,
) {
	const { t } = useTranslation()
	const categories = useCategoryOptions()
	const groups = useSiblingGroupMap()
	const group = groups.get(tag.id)
	// A display tag's delete confirmation reports its group's union
	// counts; members keep their own (their deletion really removes them).
	const effective = effectiveTagCounts(tag, group)
	const dependencyMessage = buildTagDependencyMessage(effective, categories)
	const { handleDelete, handleForceDelete } = useDeleteMutation({
		deleteOptions: deleteTagMutation(),
		forceDeleteOptions: forceDeleteTagMutation(),
		invalidate: invalidateCategoriesAndTags,
	})

	return (
		<DeleteEntityButton
			ref={ref}
			entityKindLabel={t("categories.delete.kindLabelTag")}
			entityName={tag.name}
			testId={`tag-delete-${tag.id}`}
			dependencyMessage={dependencyMessage}
			onDelete={() => handleDelete(tag.id)}
			onForceDelete={(typed) => handleForceDelete(tag.id, typed)}
			compactIcon={hideTrigger ? false : compactIcon}
			hideTrigger={hideTrigger}
		/>
	)
})

function CatsPanelSkeleton() {
	return (
		<section className="flex flex-wrap gap-1.5">
			<Skeleton className="h-7 w-24 rounded-md" />
			<Skeleton className="h-7 w-20 rounded-md" />
			<Skeleton className="h-7 w-28 rounded-md" />
		</section>
	)
}

// ── Add category / add tag (controlled dialogs) ────────────────────────────

function AddCategoryDialog(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly kind: CatKind
}) {
	const { t } = useTranslation()

	return (
		<AddEntityMetaPill
			open={props.open}
			onOpenChange={props.onOpenChange}
			label={t("me.custom.newCategory")}
			dialogTitle={t("categories.dialog.addCategoryTitle")}
			submitLabel={t("me.custom.add")}
			pendingLabel={t("categories.form.creating")}
			testIdPrefix="new-category"
			nameTestId="new-category-name"
			openButtonTestId="open-add-category-dialog"
			createButtonTestId="create-category"
			mutationOptions={createCategoryMutation()}
			invalidate={invalidateCategoriesAndTags}
			buildPayload={(meta) => ({
				...meta,
				kind: props.kind,
				color: meta.color || undefined,
			})}
			successMessageKey="categories.panel.toast.added"
			errorMessageKey="categories.panel.toast.addFailed"
		/>
	)
}

function AddTagDialog(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly catId: string
}) {
	const { t } = useTranslation()

	return (
		<AddEntityMetaPill
			open={props.open}
			onOpenChange={props.onOpenChange}
			label={t("me.custom.add")}
			dialogTitle={t("categories.dialog.addTagTitle")}
			submitLabel={t("me.custom.add")}
			testIdPrefix={`new-tag-${props.catId}`}
			nameTestId={`new-tag-name-${props.catId}`}
			openButtonTestId={`open-add-tag-dialog-${props.catId}`}
			createButtonTestId={`create-tag-${props.catId}`}
			mutationOptions={createTagMutation()}
			invalidate={invalidateCategoriesAndTags}
			buildPayload={(meta) => ({ ...meta, catId: props.catId })}
			successMessageKey="categories.panel.toast.added"
			errorMessageKey="categories.panel.toast.addFailed"
		/>
	)
}

// ── Edit dialogs ────────────────────────────────────────────────────────────

function CategoryEditDialog(props: {
	readonly category: CatWithCounts
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}) {
	const { category, open, onOpenChange } = props
	const { t } = useTranslation()

	return (
		<EntityMetaEditDialog
			entityId={category.id}
			open={open}
			onOpenChange={onOpenChange}
			title={t("categories.dialog.editCategoryTitle")}
			mutationOptions={updateCategoryMutation()}
			invalidate={invalidateCategoriesAndTags}
			initialDraft={() => entityMetaFromEntity(category)}
			buildPayload={buildEntityMetaUpdatePayload}
			contentTestId={`category-edit-dialog-${category.id}`}
			saveTestId={`category-save-${category.id}`}
			nameTestId={`category-name-${category.id}`}
			testIdPrefix={`category-${category.id}`}
			canSave={(draft) =>
				draft.name.trim() !== category.name ||
				draft.intro !== category.intro ||
				draft.color !== category.color ||
				draft.pinned !== category.pinned
			}
		/>
	)
}

function buildTagDependencyMessage(
	tag: TagWithCounts,
	categories: readonly Category[],
): string | undefined {
	const category = categories.find((c) => c.id === tag.catId)
	const kind = category?.kind ?? "common"

	const showResources = kind === "common" || kind === "resource"
	const showCharacters = kind === "common" || kind === "character"
	const resCount = showResources ? tag.resCount : 0
	const charCount = showCharacters ? tag.charCount : 0

	if (resCount === 0 && charCount === 0) return undefined

	const parts: string[] = []
	if (showResources)
		parts.push(
			i18n.t("categories.panel.dependencyResources", {
				count: tag.resCount,
			}),
		)
	if (showCharacters)
		parts.push(
			i18n.t("categories.panel.dependencyCharacters", {
				count: tag.charCount,
			}),
		)
	return i18n.t("categories.panel.dependencyMessage", {
		parts: parts.join("、"),
	})
}
