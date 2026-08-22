import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	catListWithCountsQueryOptions,
	invalidateCategories,
} from "@/features/cat"
import { invalidateTags, TagChip, updateTagMutation } from "@/features/tags"
import { useToastMutation } from "@/hooks/useToastMutation"
import type { TagWithCounts } from "./panelModel"

/**
 * Move tag dialog — the dedicated "move a tag between categories"
 * surface. The tag on the left with the category it leaves, the
 * destination picked through the category dropdown; a quiet note that the
 * rules follow. A collision in the new category surfaces as the merge
 * offer from the edit dialog.
 */
export function MoveTagDialog(props: {
	readonly tag: TagWithCounts
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}) {
	const { tag, open, onOpenChange } = props
	const { t } = useTranslation()
	const catsQ = useQuery(catListWithCountsQueryOptions())
	const categories = catsQ.data ?? []
	const currentCategory = categories.find((c) => c.id === tag.catId)
	const [targetId, setTargetId] = useState(tag.catId)

	useEffect(() => {
		if (open) setTargetId(tag.catId)
	}, [open, tag.catId])

	const moveMut = useToastMutation({
		...updateTagMutation(),
		invalidate: async (qc) => {
			await invalidateCategories(qc)
			await invalidateTags(qc)
		},
		successToastKey: "categories.panel.toast.moved",
		errorToastKey: "common.error",
		onSuccess: () => onOpenChange(false),
	})

	const canMove = targetId !== tag.catId && !moveMut.isPending

	const footer = (
		<>
			<Button
				type="button"
				variant="secondary"
				onClick={() => onOpenChange(false)}
				disabled={moveMut.isPending}
			>
				{t("common.cancel")}
			</Button>
			<Button
				type="button"
				onClick={() => moveMut.mutate({ id: tag.id, catId: targetId })}
				disabled={!canMove}
				data-testid={`move-tag-confirm-${tag.id}`}
			>
				{moveMut.isPending ? t("common.working") : t("me.custom.moveTag")}
			</Button>
		</>
	)

	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("me.custom.moveTag")}
			description={t("me.custom.moveTagDescription")}
			footer={footer}
		>
			<div className="flex flex-col gap-3.5">
				<div className="flex items-center gap-2">
					<TagChip color={tag.color} className="max-w-full">
						{tag.name}
					</TagChip>
					<span className="text-tiny text-muted-foreground">
						{t("me.custom.moveTagOut", {
							category: currentCategory?.name ?? "",
						})}
					</span>
				</div>
				<label
					htmlFor={`move-tag-category-${tag.id}`}
					className="flex flex-col gap-1 text-xs text-muted-foreground"
				>
					{t("me.custom.newCategory")}
					<DropdownSelect
						value={targetId}
						onValueChange={setTargetId}
						aria-label={t("me.custom.newCategory")}
						data-testid={`move-tag-category-${tag.id}`}
						options={categories.map((c) => ({
							value: c.id,
							label: c.name,
						}))}
					/>
				</label>
				<p className="text-xs leading-5 text-muted-foreground">
					{t("me.custom.rulesTravel")}
				</p>
			</div>
		</AppDialog>
	)
}
