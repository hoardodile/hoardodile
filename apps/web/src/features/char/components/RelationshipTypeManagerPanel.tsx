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
import {
	DeleteEntityButton,
	type DeleteEntityButtonHandle,
} from "@/components/common/DeleteEntityButton"
import { EntityCard, Meta } from "@/components/common/EntityCard"
import { EntityMetaEditDialog } from "@/components/common/EntityMetaEditDialog"
import { matchesNameQuery } from "@/components/common/entityFilter"
import { useDeleteMutation } from "@/hooks/useDeleteMutation"
import { useReorderMutation } from "@/hooks/useReorderMutation"
import { sortEntityMetas } from "@/lib/sortEntityMetas"
import {
	deleteRelationshipTypeMutation,
	forceDeleteRelationshipTypeMutation,
	invalidateRelationshipTypes,
	type RelationshipTypeWithCounts,
	relationshipTypesWithCountsQueryOptions,
	reorderRelationshipTypesMutation,
	updateRelationshipTypeMutation,
} from "../api"
import { AddRelationshipTypeDialog } from "./AddRelationshipTypeDialog"
import { RelationshipKindIcon } from "./RelationshipKindBadge"
import { RelationshipTypeDialogBody } from "./RelationshipTypeDialogBody"
import {
	buildUpdateTypePayload,
	draftFromRelationshipType,
} from "./RelationshipTypeFormFields"

export function RelationshipTypeManagerPanel() {
	const { t } = useTranslation()
	const typesQuery = useQuery(relationshipTypesWithCountsQueryOptions())
	const typesRaw: readonly RelationshipTypeWithCounts[] = typesQuery.data ?? []
	const [reorderMode, setReorderMode] = useState(false)
	const [query, setQuery] = useState("")
	const [unusedOnly, setUnusedOnly] = useState(false)
	const [addOpen, setAddOpen] = useState(false)

	const { orderIds, reorderMut, sensors, handleDragEnd } = useReorderMutation({
		mutationOptions: reorderRelationshipTypesMutation(),
		invalidate: invalidateRelationshipTypes,
		buildInput: (ids) => ({ ids }),
	})

	const types = sortEntityMetas(typesRaw, orderIds)
	const unusedCount = types.filter((type) => type.edgeCount === 0).length
	const shown = types.filter(
		(type) =>
			matchesNameQuery(type.name, query) &&
			(!unusedOnly || type.edgeCount === 0),
	)

	return (
		<div
			className="flex flex-col gap-3"
			data-testid="relationship-type-manager"
		>
			<PanelToolbar
				placeholder={t("relationshipTypes.panel.filterPlaceholder")}
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
					filter: "relationship-types-filter",
					unused: "relationship-types-unused-filter",
					reorder: "relationship-types-reorder-mode",
					add: "open-add-relationship-type-dialog",
				}}
			/>

			{typesQuery.isLoading ? (
				<ManagementSkeleton chipCount={2} />
			) : (
				<SortableChipList
					items={shown}
					renderItem={(type) => (
						<RelationshipTypeRow
							key={type.id}
							type={type}
							reorderMode={reorderMode}
							dragDisabled={!reorderMode || reorderMut.isPending}
						/>
					)}
					sensors={sensors}
					onDragEnd={handleDragEnd(types)}
					empty={
						types.length === 0 ? (
							<ManagementEmpty data-testid="relationship-types-empty">
								{t("relationshipTypes.panel.empty")}
							</ManagementEmpty>
						) : null
					}
					listClassName="grid grid-cols-2 gap-2 lg:grid-cols-4"
				/>
			)}

			<AddRelationshipTypeDialog open={addOpen} onOpenChange={setAddOpen} />
		</div>
	)
}

function RelationshipTypeRow(props: {
	readonly type: RelationshipTypeWithCounts
	readonly reorderMode: boolean
	readonly dragDisabled: boolean
}) {
	const { type, reorderMode, dragDisabled } = props
	const { t } = useTranslation()
	const unused = type.edgeCount === 0
	const title = type.intro !== "" ? `${type.name} — ${type.intro}` : type.name
	const kindLabel = t(`relationshipTypes.kind.${type.kind}.label`)

	return (
		<EntityCard
			item={type}
			reorderMode={reorderMode}
			dragDisabled={dragDisabled}
			testIdPrefix="relationship-type"
			chip={
				<TagChip
					title={title}
					size="md"
					color={type.color ?? ""}
					border={unused ? "dashed" : undefined}
					// Kind glyph + pin both ride the chip's icon slot — the
					// char search relation filter's pattern (TagChip `icon`).
					icon={
						<>
							<RelationshipKindIcon
								kind={type.kind}
								className="inline size-3"
							/>
							{type.pinned ? (
								<Pin className="inline size-3" aria-hidden />
							) : null}
						</>
					}
					className="max-w-full"
				>
					{type.name}
				</TagChip>
			}
			meta={
				unused ? (
					<Meta text={`${t("me.custom.unused")} · ${kindLabel}`} />
				) : (
					<Meta
						title={kindLabel}
						text={t("relationshipTypes.panel.linkCount", {
							count: type.edgeCount,
						})}
					/>
				)
			}
			renderEditDialog={({ open, onOpenChange }) => (
				<RelationshipTypeEditDialog
					type={type}
					open={open}
					onOpenChange={onOpenChange}
				/>
			)}
			renderDeleteButton={(ref) => (
				<RelationshipTypeDeleteButton ref={ref} type={type} hideTrigger />
			)}
		/>
	)
}

const RelationshipTypeDeleteButton = forwardRef<
	DeleteEntityButtonHandle,
	{
		readonly type: RelationshipTypeWithCounts
		readonly hideTrigger?: boolean
	}
>(function RelationshipTypeDeleteButton({ type, hideTrigger = false }, ref) {
	const { t } = useTranslation()
	const { handleDelete, handleForceDelete } = useDeleteMutation({
		deleteOptions: deleteRelationshipTypeMutation(),
		forceDeleteOptions: forceDeleteRelationshipTypeMutation(),
		invalidate: invalidateRelationshipTypes,
	})

	return (
		<DeleteEntityButton
			ref={ref}
			entityKindLabel={t("relationshipTypes.delete.kindLabel")}
			entityName={type.name}
			testId={`relationship-type-delete-${type.id}`}
			usageCount={type.edgeCount}
			usageLabel={t("relationshipTypes.delete.usageLabel")}
			usageLabelOne={t("relationshipTypes.delete.usageLabelOne")}
			onDelete={() => handleDelete(type.id)}
			onForceDelete={(typed) => handleForceDelete(type.id, typed)}
			hideTrigger={hideTrigger}
		/>
	)
})

function RelationshipTypeEditDialog(props: {
	readonly type: RelationshipTypeWithCounts
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}) {
	const { type, open, onOpenChange } = props
	const { t } = useTranslation()

	return (
		<EntityMetaEditDialog
			entityId={type.id}
			open={open}
			onOpenChange={onOpenChange}
			title={t("relationshipTypes.panel.editDialogTitle")}
			mutationOptions={updateRelationshipTypeMutation()}
			invalidate={invalidateRelationshipTypes}
			initialDraft={() => draftFromRelationshipType(type)}
			buildPayload={buildUpdateTypePayload}
			contentClassName="sm:max-w-lg"
			contentTestId={`relationship-type-edit-${type.id}`}
			saveTestId={`relationship-type-save-${type.id}`}
			fields={({ draft, patch }) => (
				<RelationshipTypeDialogBody
					draft={draft}
					onChange={patch}
					nameTestId={`relationship-type-edit-name-${type.id}`}
					metaTestIdPrefix={`relationship-type-edit-${type.id}`}
				/>
			)}
		/>
	)
}
