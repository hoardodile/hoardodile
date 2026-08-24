import {
	MAX_SEARCH_QUERY_LENGTH,
	MAX_TRAIT_NAME_LENGTH,
} from "@hoardodile/schemas"
import { Badge } from "@hoardodile/ui/components/badge"
import { ManagementEmpty } from "@hoardodile/ui/components/management-empty"
import { ManagementSkeleton } from "@hoardodile/ui/components/management-skeleton"
import { PanelToolbar } from "@hoardodile/ui/components/panel-toolbar"
import { SortableChipList } from "@hoardodile/ui/components/sortable-chip-list"
import { Pin } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { forwardRef, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	DeleteEntityButton,
	type DeleteEntityButtonHandle,
} from "@/components/common/DeleteEntityButton"
import { EntityCard, Meta } from "@/components/common/EntityCard"
import { EntityMetaEditDialog } from "@/components/common/EntityMetaEditDialog"
import { matchesNameQuery } from "@/components/common/entityFilter"
import { TagChip } from "@/features/tags/TagChip"
import { useDeleteMutation } from "@/hooks/useDeleteMutation"
import { useReorderMutation } from "@/hooks/useReorderMutation"
import {
	buildEntityMetaUpdatePayload,
	entityMetaFromEntity,
} from "@/lib/entityMetaDraft"
import { sortEntityMetas } from "@/lib/sortEntityMetas"
import {
	deleteTraitMutation,
	forceDeleteTraitMutation,
	invalidateTraits,
	reorderTraitMutation,
	type TraitDefWithCounts,
	traitListWithCountsQueryOptions,
	updateTraitMutation,
} from "./api"
import { TraitAddDialog } from "./TraitAddDialog"

/**
 * Global trait definitions - the custom page's Traits tab: one toolbar
 * (filter, unused triage, reorder, add) over a grid of bordered entity
 * cards; each card shows the trait's chip and a meta caption with its
 * kind and character count. Edit/delete live in the card's More menu.
 */
export function TraitManagementPanel() {
	const { t } = useTranslation()
	const listQuery = useQuery(traitListWithCountsQueryOptions())
	const traitsRaw: readonly TraitDefWithCounts[] = listQuery.data ?? []
	const [reorderMode, setReorderMode] = useState(false)
	const [query, setQuery] = useState("")
	const [unusedOnly, setUnusedOnly] = useState(false)
	const [addOpen, setAddOpen] = useState(false)

	const { orderIds, reorderMut, sensors, handleDragEnd } = useReorderMutation({
		mutationOptions: reorderTraitMutation(),
		invalidate: invalidateTraits,
		buildInput: (ids) => ({ ids }),
	})

	const traits = sortEntityMetas(traitsRaw, orderIds)
	const unusedCount = traits.filter((trait) => trait.charCount === 0).length
	const shown = traits.filter(
		(trait) =>
			matchesNameQuery(trait.name, query) &&
			(!unusedOnly || trait.charCount === 0),
	)

	return (
		<div className="flex flex-col gap-3">
			<PanelToolbar
				placeholder={t("traits.panel.filterPlaceholder")}
				query={query}
				onQuery={setQuery}
				maxLength={MAX_SEARCH_QUERY_LENGTH}
				reorder={reorderMode}
				onToggleReorder={() => setReorderMode((value) => !value)}
				unusedCount={unusedCount}
				unusedOnly={unusedOnly}
				onToggleUnused={() => setUnusedOnly((value) => !value)}
				onAdd={() => setAddOpen(true)}
				testIds={{
					filter: "traits-filter",
					unused: "traits-unused-filter",
					reorder: "traits-reorder-mode",
					add: "open-add-trait-dialog",
				}}
			/>

			{listQuery.isLoading ? (
				<ManagementSkeleton chipCount={2} />
			) : (
				<SortableChipList
					items={shown}
					renderItem={(trait) => (
						<TraitRow
							key={trait.id}
							trait={trait}
							reorderMode={reorderMode}
							dragDisabled={!reorderMode || reorderMut.isPending}
						/>
					)}
					sensors={sensors}
					onDragEnd={handleDragEnd(traits)}
					empty={
						traits.length === 0 ? (
							<ManagementEmpty data-testid="trait-empty">
								{t("traits.panel.empty")}
							</ManagementEmpty>
						) : null
					}
					listClassName="grid grid-cols-2 gap-2 lg:grid-cols-4"
				/>
			)}

			<TraitAddDialog open={addOpen} onOpenChange={setAddOpen} />
		</div>
	)
}

function TraitRow(props: {
	readonly trait: TraitDefWithCounts
	readonly reorderMode: boolean
	readonly dragDisabled: boolean
}) {
	const { trait, reorderMode, dragDisabled } = props
	const { t } = useTranslation()
	const kindLabel = t(`traits.kind.${trait.kind}`)
	const unused = trait.charCount === 0

	return (
		<EntityCard
			item={trait}
			reorderMode={reorderMode}
			dragDisabled={dragDisabled}
			testIdPrefix="trait"
			chip={
				<TagChip
					title={trait.name}
					size="md"
					color={trait.color ?? ""}
					border={unused ? "dashed" : undefined}
					icon={
						trait.pinned ? (
							<Pin className="inline size-3" aria-hidden />
						) : undefined
					}
					className="max-w-full"
				>
					{trait.name}
				</TagChip>
			}
			meta={
				unused ? (
					<Meta text={`${t("me.custom.unused")} Â· ${kindLabel}`} />
				) : (
					<Meta text={`${kindLabel} Â· ${String(trait.charCount)}`} />
				)
			}
			renderEditDialog={({ open, onOpenChange }) => (
				<TraitEditDialog
					trait={trait}
					open={open}
					onOpenChange={onOpenChange}
				/>
			)}
			renderDeleteButton={(ref) => (
				<TraitDeleteButton ref={ref} trait={trait} hideTrigger />
			)}
		/>
	)
}

const TraitDeleteButton = forwardRef<
	DeleteEntityButtonHandle,
	{
		readonly trait: TraitDefWithCounts
		readonly compactIcon?: boolean
		readonly hideTrigger?: boolean
	}
>(function TraitDeleteButton(
	{ trait, compactIcon = false, hideTrigger = false },
	ref,
) {
	const { t } = useTranslation()
	const { handleDelete, handleForceDelete } = useDeleteMutation({
		deleteOptions: deleteTraitMutation(),
		forceDeleteOptions: forceDeleteTraitMutation(),
		invalidate: invalidateTraits,
	})

	return (
		<DeleteEntityButton
			ref={ref}
			entityKindLabel={t("traits.delete.kindLabel")}
			entityName={trait.name}
			testId={`trait-delete-${trait.id}`}
			usageCount={trait.charCount}
			usageLabel={t("traits.delete.usageLabel")}
			usageLabelOne={t("traits.delete.usageLabelOne")}
			onDelete={() => handleDelete(trait.id)}
			onForceDelete={(typed) => handleForceDelete(trait.id, typed)}
			compactIcon={hideTrigger ? false : compactIcon}
			hideTrigger={hideTrigger}
		/>
	)
})

function TraitEditDialog(props: {
	readonly trait: TraitDefWithCounts
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}) {
	const { trait, open, onOpenChange } = props
	const { t } = useTranslation()

	return (
		<EntityMetaEditDialog
			entityId={trait.id}
			open={open}
			onOpenChange={onOpenChange}
			title={t("traits.panel.editDialogTitle")}
			mutationOptions={updateTraitMutation()}
			invalidate={invalidateTraits}
			initialDraft={() => entityMetaFromEntity(trait)}
			buildPayload={(id, draft) =>
				buildEntityMetaUpdatePayload(id, {
					...draft,
					color: draft.color.trim(),
					intro: draft.intro.trim(),
				})
			}
			contentTestId={`trait-edit-${trait.id}`}
			saveTestId={`trait-save-${trait.id}`}
			nameTestId={`trait-edit-name-${trait.id}`}
			testIdPrefix={`trait-edit-${trait.id}`}
			maxNameLength={MAX_TRAIT_NAME_LENGTH}
		>
			<Badge variant="secondary" className="w-fit rounded-md text-sm">
				{t(`traits.kind.${trait.kind}`)}
			</Badge>
		</EntityMetaEditDialog>
	)
}
