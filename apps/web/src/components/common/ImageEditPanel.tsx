import { useState } from "react"
import { useTranslation } from "react-i18next"
import { useImageDelete } from "@/hooks/useImageDelete"
import { ConfirmDialog } from "./ConfirmDialog"
import { ImageCropPanel, type ImageCropPanelProps } from "./ImageCropPanel"

export type ImageEditPanelProps = ImageCropPanelProps & {
	/** DELETE endpoint URL. When omitted the remove button is hidden. */
	readonly deleteUrl?: string
	/** Called after a successful DELETE to invalidate query caches. */
	readonly onInvalidate?: () => Promise<void>
	/** Optional callback fired after invalidate completes. */
	readonly onDeleted?: () => void
	readonly deleteTestId?: string
}

/**
 * Wraps {@link ImageCropPanel} with a confirmation dialog for removing
 * the existing image. When the crop panel has no selected image, its
 * action button becomes "Remove"; clicking it opens a confirm dialog
 * before calling the DELETE endpoint.
 */
export function ImageEditPanel(props: ImageEditPanelProps) {
	const {
		deleteUrl,
		onInvalidate,
		onDeleted,
		deleteTestId,
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

	function handleClear() {
		if (canDelete) setConfirmOpen(true)
	}

	async function handleConfirmDelete() {
		await deleteImage()
		setConfirmOpen(false)
	}

	return (
		<div className="flex flex-col gap-4">
			<ImageCropPanel
				{...cropPanelProps}
				onClear={canDelete ? handleClear : undefined}
			/>
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
