import type { CroppedImage } from "@hoardodile/ui/components/image-cropper"
import { useQueryClient } from "@tanstack/react-query"
import { ImageEditPanel } from "@/components/common/ImageEditPanel"
import { useExistingImageSrc } from "@/hooks/useExistingImageSrc"
import { mimeToImageExt } from "@/lib/mime"
import { apiPaths } from "@/lib/paths"
import { invalidateTags, uploadTagImage } from "./api"

export type TagImagePanelProps = {
	readonly tagId: string
	readonly onSaved?: () => void
}

/**
 * Panel that lets the user pick + crop an image, then uploads it as the
 * tag's art (free aspect — logos and wide art keep their proportions).
 * PNG output preserves transparency end-to-end; slot plumbing is the
 * shared image-slot HTTP surface (`PUT /api/tags/:id/images/image`).
 */
export function TagImagePanel(props: TagImagePanelProps) {
	const { tagId, onSaved } = props
	const qc = useQueryClient()

	// Preload the existing tag art so the danger "Remove" button is shown
	// (the crop panel's primary stays "Save", never a remove).
	const existingSrc = useExistingImageSrc(apiPaths.tags.image(tagId))

	async function handleSave(cropped: CroppedImage) {
		await uploadTagImage(
			tagId,
			cropped.blob,
			`image${mimeToImageExt(cropped.mimeType)}`,
		)
		await invalidateTags(qc)
	}

	return (
		<ImageEditPanel
			mimeType="image/png"
			previewShape="square"
			cropStageWidth={240}
			cropStageHeight={240}
			initialSrc={existingSrc}
			onSave={handleSave}
			onSaved={onSaved}
			deleteUrl={apiPaths.tags.image(tagId)}
			onInvalidate={async () => invalidateTags(qc)}
			onDeleted={onSaved}
			deleteTestId={`tag-image-delete-${tagId}`}
			removeTestId={`tag-image-remove-${tagId}`}
		/>
	)
}
