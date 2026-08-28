import type { CroppedImage } from "@hoardodile/ui/components/image-cropper"
import { useQueryClient } from "@tanstack/react-query"
import { ImageEditPanel } from "@/components/common/ImageEditPanel"
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
			onSave={handleSave}
			onSaved={onSaved}
			deleteUrl={apiPaths.tags.image(tagId)}
			onInvalidate={async () => invalidateTags(qc)}
			onDeleted={onSaved}
			deleteTestId={`tag-image-delete-${tagId}`}
		/>
	)
}
