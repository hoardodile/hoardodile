import type { CroppedImage } from "@hoardodile/ui/components/image-cropper"
import { useQueryClient } from "@tanstack/react-query"
import { ImageEditPanel } from "@/components/common/ImageEditPanel"
import { mimeToImageExt } from "@/lib/mime"
import { apiPaths } from "@/lib/paths"
import { invalidateCharacters, uploadCharImage } from "../api"

export type CharImageVariant = "avatar" | "fullbody"

export type CharImagePanelProps = {
	readonly charId: string
	readonly variant: CharImageVariant
	readonly onSaved?: () => void
}

/**
 * Panel that lets the user pick + crop an image, then uploads it as
 * the character's avatar or fullbody illustration. Avatars are forced
 * to a 1:1 aspect ratio; fullbody illustrations remain free-aspect.
 * PNG output preserves transparency end-to-end.
 */
export function CharImagePanel(props: CharImagePanelProps) {
	const { charId, variant, onSaved } = props
	const qc = useQueryClient()

	async function handleSave(cropped: CroppedImage) {
		await uploadCharacterImage(charId, variant, cropped)
		await invalidateCharacters(qc, charId)
	}

	return (
		<ImageEditPanel
			mimeType="image/png"
			aspect={variant === "avatar" ? 1 : undefined}
			previewShape={variant === "avatar" ? "circle" : "square"}
			cropStageWidth={variant === "avatar" ? 200 : 260}
			cropStageHeight={variant === "avatar" ? 200 : 500}
			onSave={handleSave}
			onSaved={onSaved}
			deleteUrl={apiPaths.characters.image(charId, variant)}
			onInvalidate={async () => invalidateCharacters(qc, charId)}
			onDeleted={onSaved}
			deleteTestId={`character-image-delete-${variant}`}
		/>
	)
}

/**
 * @throws HttpError when the server rejects the upload.
 */
async function uploadCharacterImage(
	charId: string,
	variant: CharImageVariant,
	cropped: CroppedImage,
): Promise<void> {
	const ext = mimeToImageExt(cropped.mimeType)
	await uploadCharImage(charId, variant, cropped.blob, `${variant}${ext}`)
}
