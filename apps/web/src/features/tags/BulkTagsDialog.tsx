import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { toast } from "@hoardodile/ui/components/toast"
import { useMutation, useQueries, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useRef, useState } from "react"
import { useTranslation } from "react-i18next"
import { DualTagPicker } from "@/components/common/DualTagPicker"
import { invalidateCharacters } from "@/features/char/api"
import { invalidateResources } from "@/features/res/api"
import { errorMessage } from "@/lib/errors"
import {
	bulkAttachToCharactersMutation,
	bulkAttachToResourcesMutation,
	bulkDetachFromCharactersMutation,
	bulkDetachFromResourcesMutation,
	invalidateTags,
	tagsForCharacterQueryOptions,
	tagsForResourceQueryOptions,
} from "./api"
import {
	computeCommonAndNonCommonTagIds,
	computeTagDiff,
} from "./utils/bulkTagCalc"

export type BulkTagsDialogProps = {
	readonly kind: "character" | "resource"
	readonly ids: readonly string[]
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
}

export function BulkTagsDialog(props: BulkTagsDialogProps) {
	const { kind, ids, open, onOpenChange } = props
	const { t } = useTranslation()
	const qc = useQueryClient()

	const queryOptions =
		kind === "resource"
			? tagsForResourceQueryOptions
			: tagsForCharacterQueryOptions

	// Stabilise the queries array so useQueries does not re-subscribe on
	// every render (React Query compares by reference).
	const queries = useMemo(() => {
		return ids.map((id) => ({
			...queryOptions(id),
			enabled: open && ids.length > 0,
		}))
	}, [ids.join(","), open, queryOptions])

	const tagQueries = useQueries({ queries })

	const isLoading = tagQueries.some((q) => q.isLoading)
	const hasError = tagQueries.some((q) => q.isError)

	const { commonTagIds, nonCommonTagIds } =
		computeCommonAndNonCommonTagIds(tagQueries)
	const nonCommonCount = nonCommonTagIds.length

	const [selected, setSelected] = useState<readonly string[]>([])
	const lastKeyRef = useRef("")

	// Sync selected to commonTagIds whenever the dialog opens or the
	// underlying data changes, but preserve user edits across re-renders
	// that do not change the actual tag set.
	useEffect(() => {
		if (!open) {
			lastKeyRef.current = ""
			return
		}
		const key = commonTagIds.join(",")
		if (key !== lastKeyRef.current) {
			lastKeyRef.current = key
			setSelected(commonTagIds)
		}
	}, [open, commonTagIds])

	const attachMut = useMutation(
		kind === "resource"
			? bulkAttachToResourcesMutation()
			: bulkAttachToCharactersMutation(),
	)
	const detachMut = useMutation(
		kind === "resource"
			? bulkDetachFromResourcesMutation()
			: bulkDetachFromCharactersMutation(),
	)
	const isPending = attachMut.isPending || detachMut.isPending

	async function handleSave() {
		if (ids.length === 0) return

		const { toAttach, toDetach } = computeTagDiff(commonTagIds, selected)

		try {
			await Promise.all([
				...toAttach.map((tagId) =>
					attachMut.mutateAsync({ ids: [...ids], tagId }),
				),
				...toDetach.map((tagId) =>
					detachMut.mutateAsync({ ids: [...ids], tagId }),
				),
			])

			// Invalidate all tag queries in one shot instead of looping over ids
			await invalidateTags(qc)

			if (kind === "resource") {
				await invalidateResources(qc)
			} else {
				await invalidateCharacters(qc)
			}

			toast.add({ title: t("common.saved"), type: "success" })
			onOpenChange(false)
		} catch (err) {
			toast.add({
				title: errorMessage(err, t("common.saveFailed")),
				type: "error",
			})
		}
	}

	const title =
		kind === "resource"
			? t("resources.bulk.editTags")
			: t("characters.bulk.editTags")

	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={title}
			size="lg"
			footer={
				<>
					<Button
						variant="secondary"
						onClick={() => onOpenChange(false)}
						disabled={isPending}
					>
						{t("common.cancel")}
					</Button>
					<Button
						onClick={() => void handleSave()}
						disabled={isPending || isLoading || hasError}
						data-testid="bulk-tags-save"
					>
						{isPending ? t("common.saving") : t("common.save")}
					</Button>
				</>
			}
		>
			<div className="min-h-80">
				{isLoading ? (
					<p className="text-sm text-muted-foreground">{t("common.loading")}</p>
				) : hasError ? (
					<p className="text-sm text-destructive">{t("common.loadFailed")}</p>
				) : (
					<>
						{nonCommonCount > 0 ? (
							<p className="mb-2 text-xs text-muted-foreground">
								{t("tags.bulk.nonCommonHint", {
									count: nonCommonCount,
								})}
							</p>
						) : null}
						<DualTagPicker
							value={selected}
							onChange={setSelected}
							kind={kind}
						/>
					</>
				)}
			</div>
		</AppDialog>
	)
}
