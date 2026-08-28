import { MAX_URL_LENGTH } from "@hoardodile/schemas"
import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Input } from "@hoardodile/ui/components/input"
import { Label } from "@hoardodile/ui/components/label"
import { BranchingPathsUp } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { EntityMetaEditDialog } from "@/components/common/EntityMetaEditDialog"
import {
	tagListWithCountsQueryOptions,
	updateTagMutation,
} from "@/features/tags"
import { MergeTagsDialog } from "@/features/tags/MergeTagsDialog"
import {
	buildEntityMetaUpdatePayload,
	entityMetaFromEntity,
} from "@/lib/entityMetaDraft"
import type { TagWithCounts } from "./panelModel"
import { invalidateCategoriesAndTags, useCategoryOptions } from "./panelShared"

/**
 * Edit dialog for one tag: the shared entity-meta form plus the
 * tag-specific fields — the category select and the external link. The
 * link is kept in local state below the shared draft because the draft
 * schema is category-agnostic; the save payload merges it in and the
 * save gate treats a trimmed difference as dirty. Tag art is managed
 * through the card's own image button (see {@link TagImageMenuButton}),
 * so the metadata dialog stays focused.
 */
export function TagEditDialog(props: {
	readonly tag: TagWithCounts
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}) {
	const { tag, open, onOpenChange } = props
	const { t } = useTranslation()
	const originalLink = tag.link ?? ""
	const [catId, setCategoryId] = useState<string>(tag.catId)
	const [linkDraft, setLinkDraft] = useState<string>(originalLink)
	const categories = useCategoryOptions()
	const tagsQ = useQuery(tagListWithCountsQueryOptions())
	const [collision, setCollision] = useState<TagWithCounts | undefined>(
		undefined,
	)
	const [mergeOpen, setMergeOpen] = useState(false)

	useEffect(() => {
		if (!open) return
		setCategoryId(tag.catId)
		setLinkDraft(tag.link ?? "")
		setCollision(undefined)
	}, [open, tag.catId, tag.link])

	function handleSaveError(
		_input: unknown,
		payload: { readonly name?: string },
	) {
		const inputName = payload.name?.trim() ?? ""
		const colliding = (tagsQ.data ?? []).find(
			(c) =>
				c.id !== tag.id && c.catId === catId && c.name.trim() === inputName,
		)
		setCollision(colliding)
	}

	return (
		<>
			<EntityMetaEditDialog
				entityId={tag.id}
				open={open}
				onOpenChange={onOpenChange}
				title={t("categories.dialog.editTagTitle")}
				mutationOptions={updateTagMutation()}
				invalidate={invalidateCategoriesAndTags}
				initialDraft={() => entityMetaFromEntity(tag)}
				buildPayload={(id, draft) => ({
					...buildEntityMetaUpdatePayload(id, draft),
					catId,
					link: linkDraft.trim(),
				})}
				onSaveError={handleSaveError}
				contentTestId={`tag-edit-${tag.id}`}
				saveTestId={`tag-save-${tag.id}`}
				nameTestId={`tag-name-${tag.id}`}
				testIdPrefix={`tag-${tag.id}`}
				canSave={(draft) =>
					draft.name.trim() !== tag.name ||
					draft.intro !== tag.intro ||
					draft.color !== tag.color ||
					draft.pinned !== tag.pinned ||
					linkDraft.trim() !== originalLink ||
					catId !== tag.catId
				}
			>
				<DropdownSelect
					value={catId}
					onValueChange={(value) => {
						setCategoryId(value)
						setCollision(undefined)
					}}
					data-testid={`tag-category-${tag.id}`}
					options={categories.map((c) => ({
						value: c.id,
						label: c.name,
					}))}
				/>
				<div className="flex flex-col gap-1.5">
					<Label
						htmlFor={`tag-link-${tag.id}`}
						className="text-xs font-normal text-muted-foreground"
					>
						{t("tags.edit.linkLabel")}
					</Label>
					<Input
						id={`tag-link-${tag.id}`}
						value={linkDraft}
						onChange={(e) => setLinkDraft(e.target.value)}
						placeholder={t("tags.edit.linkPlaceholder")}
						maxLength={MAX_URL_LENGTH}
						data-testid={`tag-link-${tag.id}`}
						autoComplete="off"
					/>
					<p className="text-xs text-muted-foreground">
						{t("tags.edit.linkHint")}
					</p>
				</div>
				{collision !== undefined ? (
					<div
						className="flex items-center justify-between gap-3 rounded-lg bg-muted/60 px-3 py-2"
						data-testid={`tag-merge-offer-${tag.id}`}
					>
						<span className="text-xs leading-5 text-secondary-foreground">
							{t("tags.merge.collision", { name: collision.name })}
						</span>
						<Button
							type="button"
							variant="ghost"
							onClick={() => setMergeOpen(true)}
							data-testid={`tag-merge-offer-button-${tag.id}`}
						>
							<BranchingPathsUp className="size-4" aria-hidden />
							{t("tags.merge.offer")}
						</Button>
					</div>
				) : null}
			</EntityMetaEditDialog>
			{collision !== undefined ? (
				<MergeTagsDialog
					source={tag}
					open={mergeOpen}
					onOpenChange={setMergeOpen}
					initialTargetId={collision.id}
					onMerged={() => onOpenChange(false)}
				/>
			) : null}
		</>
	)
}
