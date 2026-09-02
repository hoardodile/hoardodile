import { DialogFooterLeadingActions } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import {
	ImageCropPanel,
	type ImageCropPanelProps,
} from "@hoardodile/ui/components/image-crop-panel"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useImageDelete } from "@/hooks/useImageDelete"

export type ImageEditPanelProps = ImageCropPanelProps & {
	/** DELETE endpoint URL. When omitted the remove button is hidden. */
	readonly deleteUrl?: string
	/** Called after a successful DELETE to invalidate query caches. */
	readonly onInvalidate?: () => Promise<void>
	/** Optional callback fired after invalidate completes. */
	readonly onDeleted?: () => void
	readonly deleteTestId?: string
	/** Test id for the explicit "Remove" button shown when a current image is preloaded. */
	readonly removeTestId?: string
}

/**
 * Wraps {@link ImageCropPanel} with a confirmation dialog for removing
 * the existing image. The crop panel's primary action stays "Save"; the
 * remove action is a dedicated danger button (placed at the footer's left
 * edge) that opens a confirm dialog before calling the DELETE endpoint.
 */
export function ImageEditPanel(props: ImageEditPanelProps) {
	const {
		deleteUrl,
		onInvalidate,
		onDeleted,
		deleteTestId,
		removeTestId,
		...cropPanelProps
	} = props
	const { t } = useTranslation()
	const [confirmOpen, setConfirmOpen] = useState(false)

	const { deleteImage, isDeleting } = useImageDelete({
		url: deleteUrl ?? "",
		invalidate: onInvalidate ?? (async () => {}),
		onDeleted,
	})

	const canDelete =
		deleteUrl !== undefined &&
		deleteUrl.length > 0 &&
		onInvalidate !== undefined

	// The primary action is always "Save" (never a remove). When a current
	// image exists (preloaded via `initialSrc`) we surface a dedicated danger
	// "Remove" button at the footer's left edge (DESIGN.md — three-button
	// footers); with no image there is nothing to remove, so it stays hidden.
	const showRemoveCurrent = canDelete && cropPanelProps.initialSrc !== undefined

	function handleClear() {
		if (canDelete) setConfirmOpen(true)
	}

	async function handleConfirmDelete() {
		await deleteImage()
		setConfirmOpen(false)
	}

	return (
		<div className="flex flex-col gap-4">
			<ImageCropPanel {...cropPanelProps} />
			{showRemoveCurrent ? (
				<DialogFooterLeadingActions>
					<Button
						type="button"
						variant="destructive"
						onClick={handleClear}
						data-testid={removeTestId}
					>
						{t("common.remove")}
					</Button>
				</DialogFooterLeadingActions>
			) : null}
			{canDelete ? (
				<ConfirmDialog
					open={confirmOpen}
					onOpenChange={setConfirmOpen}
					title={t("imageEdit.confirmDeleteTitle")}
					description={t("imageEdit.confirmDeleteDescription")}
					confirmLabel={t("common.remove")}
					pendingLabel={t("common.saving")}
					isPending={isDeleting}
					destructive
					onConfirm={handleConfirmDelete}
					confirmTestId={deleteTestId}
				/>
			) : null}
		</div>
	)
}
