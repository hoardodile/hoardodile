import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { toast } from "@hoardodile/ui/components/toast"
import { ArrowRight } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	catListWithCountsQueryOptions,
	invalidateCategories,
} from "@/features/cat"
import type { TagWithCounts } from "@/features/cat/panelModel"
import { invalidateCharacters } from "@/features/char/api"
import { invalidateResources } from "@/features/res/api"
import { useToastMutation } from "@/hooks/useToastMutation"
import {
	invalidateTags,
	mergeTagsMutation,
	tagMergePreviewQueryOptions,
} from "./api"
import { tagErrorMessage } from "./errors"
import { TagChip } from "./TagChip"
import { TagSinglePicker } from "./TagSinglePicker"

export type MergeTagsDialogProps = {
	readonly source: TagWithCounts
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	/** Pre-selected target (e.g. the tag a rename just collided with). */
	readonly initialTargetId?: string
	/** Extra side effect after a successful merge. */
	readonly onMerged?: () => void
}

/**
 * Merge a duplicate tag into a survivor. Preview first (the number of
 * resource/character usages and rules that would move — the server
 * rejects cross-kind merges and merges that would create a rule cycle at
 * this point too), then confirm. Merging is a first-class operation: it
 * is the only way duplicates disappear after the uniqueness rules apply.
 */
export function MergeTagsDialog(props: MergeTagsDialogProps) {
	const { source, open, onOpenChange, initialTargetId, onMerged } = props
	const { t } = useTranslation()
	const catsQ = useQuery(catListWithCountsQueryOptions())

	const sourceCategory = (catsQ.data ?? []).find((c) => c.id === source.catId)
	const sourceKind = sourceCategory?.kind ?? "common"

	const [targetId, setTargetId] = useState<string | undefined>(undefined)

	useEffect(() => {
		if (!open) return
		setTargetId(initialTargetId)
	}, [open, initialTargetId])

	const preview = useQuery(
		tagMergePreviewQueryOptions(
			targetId !== undefined ? source.id : undefined,
			targetId,
		),
	)

	const mergeMut = useToastMutation({
		...mergeTagsMutation(),
		invalidate: async (qc) => {
			// A merge rewrites the tag lists of many resources and
			// characters, so the blast radius is the whole library.
			await invalidateTags(qc)
			await invalidateCategories(qc)
			await invalidateResources(qc)
			await invalidateCharacters(qc)
		},
		onSuccess: (result) => {
			onOpenChange(false)
			onMerged?.()
			toast.add({
				title: t("tags.merge.toast.success", {
					resources: result.movedResources,
					characters: result.movedCharacters,
					siblingRules: result.movedSiblingRules,
					parentRules: result.movedParentRules,
				}),
				type: "success",
			})
		},
		resolveError: tagErrorMessage,
	})

	function handleConfirm() {
		if (targetId === undefined) return
		mergeMut.mutate({ sourceId: source.id, targetId })
	}

	const previewError =
		preview.error !== null ? tagErrorMessage(preview.error, t) : undefined

	const footer = (
		<>
			<Button
				type="button"
				variant="secondary"
				onClick={() => onOpenChange(false)}
				disabled={mergeMut.isPending}
			>
				{t("common.cancel")}
			</Button>
			<Button
				type="button"
				onClick={handleConfirm}
				disabled={
					targetId === undefined ||
					preview.isLoading ||
					preview.data === undefined ||
					mergeMut.isPending
				}
				data-testid="tag-merge-confirm"
			>
				{mergeMut.isPending
					? t("tags.merge.confirming")
					: t("tags.merge.confirm")}
			</Button>
		</>
	)

	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("tags.merge.title")}
			description={t("tags.merge.description")}
			size="sm"
			footer={footer}
			contentTestId="tag-merge-dialog"
		>
			{/* The directed merge: the duplicate on the
			    left, the target picker on the right — the arrow rests the eye
			    on the destination. */}
			<div className="flex flex-col gap-3">
				<div className="flex items-center gap-2">
					<TagChip color={source.color} className="shrink-0">
						{source.name}
					</TagChip>
					<ArrowRight className="size-4 shrink-0 text-muted-foreground" />
					<TagSinglePicker
						value={targetId ?? ""}
						onChange={setTargetId}
						kind={sourceKind}
						placeholder={t("tags.merge.targetPlaceholder")}
						testId="tag-merge-target"
					/>
				</div>
				{previewError !== undefined ? (
					<p
						className="text-xs text-destructive"
						data-testid="tag-merge-preview-error"
					>
						{previewError}
					</p>
				) : null}
				{preview.data !== undefined ? (
					<p
						className="rounded-lg bg-muted px-3 py-2 text-tiny text-muted-foreground"
						data-testid="tag-merge-preview"
					>
						{t("tags.merge.preview", {
							resources: preview.data.resourceCount,
							characters: preview.data.characterCount,
							siblingRules: preview.data.siblingRuleCount,
							parentRules: preview.data.parentRuleCount,
						})}
					</p>
				) : null}
			</div>
		</AppDialog>
	)
}
