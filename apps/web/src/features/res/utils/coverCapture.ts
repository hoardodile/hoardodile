import type { CroppedImage } from "@hoardodile/ui/components/image-cropper"
import type { QueryClient } from "@tanstack/react-query"
import { invalidateResources, uploadResCover } from "@/features/res/api"
import { mimeToImageExt } from "@/lib/mime"

/**
 * Upload a cropped image as the resource cover (correct filename extension)
 * and refresh resource caches.
 *
 * @throws Error when the server rejects the upload.
 */
export async function uploadResCoverCropped(
	resId: string,
	cropped: CroppedImage,
	qc: QueryClient,
): Promise<void> {
	const ext = mimeToImageExt(cropped.mimeType)
	await uploadResCover(
		resId,
		cropped.blob,
		`cover${ext}`,
		"application/octet-stream",
	)
	await invalidateResources(qc, resId)
}
