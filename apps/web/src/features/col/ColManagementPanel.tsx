import type { ResCollection } from "@hoardodile/schemas"
import { MAX_SEARCH_QUERY_LENGTH } from "@hoardodile/schemas"
import { ManagementEmpty } from "@hoardodile/ui/components/management-empty"
import { ManagementSkeleton } from "@hoardodile/ui/components/management-skeleton"
import { PanelToolbar } from "@hoardodile/ui/components/panel-toolbar"
import { SortableChipList } from "@hoardodile/ui/components/sortable-chip-list"
import { TagChip } from "@hoardodile/ui/components/tag-chip"
import { Pin } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { forwardRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { AddEntityMetaPill } from "@/components/common/AddEntityMetaPill"
import {
	DeleteEntityButton,
	type DeleteEntityButtonHandle,
} from "@/components/common/DeleteEntityButton"
import { EntityCard, Meta } from "@/components/common/EntityCard"
import { EntityMetaEditDialog } from "@/components/common/EntityMetaEditDialog"
import { matchesNameQuery } from "@/components/common/entityFilter"
import { useDeleteMutation } from "@/hooks/useDeleteMutation"
import { useReorderMutation } from "@/hooks/useReorderMutation"
import {
	buildEntityMetaUpdatePayload,
	entityMetaFromEntity,
} from "@/lib/entityMetaDraft"
import { sortEntityMetas } from "@/lib/sortEntityMetas"
import {
	colListWithCountsQueryOptions,
	createCollectionMutation,
	deleteCollectionMutation,
	forceDeleteCollectionMutation,
	invalidateCollections,
	reorderCollectionsMutation,
	updateCollectionMutation,
} from "./api"

export type ColWithCounts = ResCollection & {
	readonly resCount: number
}

/**
 * Resource collections — the custom page's Collections tab: one toolbar
 * (filter, unused triage, reorder, add) over a grid of bordered entity
 * cards; each card shows the collection's chip and a meta caption with
 * its resource count. Edit/delete live in the card's More menu.
 */
export function ColManagementPanel() {
	const { t } = useTranslation()
	const { data: collections, isLoading } = useQuery(
		colListWithCountsQueryOptions(),
	)
	const [reorderMode, setReorderMode] = useState(false)
	const [query, setQuery] = useState("")
	const [unusedOnly, setUnusedOnly] = useState(false)
	const [addOpen, setAddOpen] = useState(false)

	const { orderIds, reorderMut, sensors, handleDragEnd } = useReorderMutation({
		mutationOptions: reorderCollectionsMutation(),
		invalidate: invalidateCollections,
		buildInput: (ids) => ({ ids }),
	})

	const sorted = sortEntityMetas(collections ?? [], orderIds)
	const unusedCount = sorted.filter((col) => col.resCount === 0).length
	const shown = sorted.filter(
		(col) =>
			matchesNameQuery(col.name, query) && (!unusedOnly || col.resCount === 0),
	)

	return (
		<div className="flex flex-col gap-3">
			<PanelToolbar
				placeholder={t("collections.panel.filterPlaceholder")}
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
					filter: "collections-filter",
					unused: "collections-unused-filter",
					reorder: "collections-reorder-mode",
					add: "open-add-collection-dialog",
				}}
			/>

			{isLoading ? (
				<ManagementSkeleton chipCount={2} />
			) : (
				<SortableChipList
					items={shown}
					renderItem={(collection) => (
						<ColRow
							key={collection.id}
							collection={collection}
							reorderMode={reorderMode}
							dragDisabled={!reorderMode || reorderMut.isPending}
						/>
					)}
					sensors={sensors}
					onDragEnd={handleDragEnd(sorted)}
					empty={
						sorted.length === 0 ? (
							<ManagementEmpty data-testid="collections-empty">
								{t("collections.panel.empty")}
							</ManagementEmpty>
						) : null
					}
					listClassName="grid grid-cols-2 gap-2 lg:grid-cols-4"
				/>
			)}

			<AddCollectionDialog open={addOpen} onOpenChange={setAddOpen} />
		</div>
	)
}

function AddCollectionDialog(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}) {
	const { t } = useTranslation()

	return (
		<AddEntityMetaPill
			open={props.open}
			onOpenChange={props.onOpenChange}
			label={t("me.custom.add")}
			dialogTitle={t("collections.panel.addDialogTitle")}
			submitLabel={t("me.custom.add")}
			testIdPrefix="collection-create"
			nameTestId="collection-create-name"
			openButtonTestId="open-add-collection-dialog"
			createButtonTestId="collection-create-submit"
			mutationOptions={createCollectionMutation()}
			invalidate={invalidateCollections}
			buildPayload={(payload) => payload}
			successMessageKey="categories.panel.toast.added"
		/>
	)
}

function ColRow(props: {
	readonly collection: ColWithCounts
	readonly reorderMode: boolean
	readonly dragDisabled: boolean
}) {
	const { collection, reorderMode, dragDisabled } = props
	const { t } = useTranslation()
	const unused = collection.resCount === 0
	const title =
		collection.intro !== "" && collection.intro !== undefined
			? `${collection.name} — ${collection.intro}`
			: collection.name

	return (
		<EntityCard
			item={collection}
			reorderMode={reorderMode}
			dragDisabled={dragDisabled}
			testIdPrefix="collection"
			editMenuTestId={`collection-edit-${collection.id}`}
			chip={
				<TagChip
					title={title}
					size="md"
					color={collection.color ?? ""}
					border={unused ? "dashed" : undefined}
					icon={
						collection.pinned ? (
							<Pin className="inline size-3" aria-hidden />
						) : undefined
					}
					className="max-w-full"
				>
					{collection.name}
				</TagChip>
			}
			meta={
				unused ? (
					<Meta text={t("me.custom.unused")} />
				) : (
					<Meta text={String(collection.resCount)} />
				)
			}
			renderEditDialog={({ open, onOpenChange }) => (
				<ColEditDialog
					collection={collection}
					open={open}
					onOpenChange={onOpenChange}
				/>
			)}
			renderDeleteButton={(ref) => (
				<ColDeleteButton ref={ref} collection={collection} hideTrigger />
			)}
		/>
	)
}

const ColDeleteButton = forwardRef<
	DeleteEntityButtonHandle,
	{
		readonly collection: ColWithCounts
		readonly hideTrigger?: boolean
	}
>(function ColDeleteButton({ collection, hideTrigger = false }, ref) {
	const { t } = useTranslation()
	const { handleDelete, handleForceDelete } = useDeleteMutation({
		deleteOptions: deleteCollectionMutation(),
		forceDeleteOptions: forceDeleteCollectionMutation(),
		invalidate: invalidateCollections,
	})

	return (
		<DeleteEntityButton
			ref={ref}
			hideTrigger={hideTrigger}
			entityKindLabel={t("collections.entityLabel")}
			entityName={collection.name}
			testId={`collection-delete-${collection.id}`}
			onDelete={() => handleDelete(collection.id)}
			onForceDelete={(typed) => handleForceDelete(collection.id, typed)}
			usageCount={collection.resCount}
			usageLabel={t("collections.usageLabel")}
			usageLabelOne={t("collections.usageLabelOne")}
		/>
	)
})

function ColEditDialog(props: {
	readonly collection: ColWithCounts
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}) {
	const { collection, open, onOpenChange } = props
	const { t } = useTranslation()

	return (
		<EntityMetaEditDialog
			entityId={collection.id}
			open={open}
			onOpenChange={onOpenChange}
			title={t("collections.panel.editDialogTitle")}
			mutationOptions={updateCollectionMutation()}
			invalidate={invalidateCollections}
			initialDraft={() => entityMetaFromEntity(collection)}
			buildPayload={(id, draft) =>
				buildEntityMetaUpdatePayload(id, {
					...draft,
					color: draft.color.trim(),
				})
			}
			contentTestId={`collection-edit-dialog-${collection.id}`}
			saveTestId={`collection-edit-submit-${collection.id}`}
			testIdPrefix={`collection-edit-${collection.id}`}
		/>
	)
}
