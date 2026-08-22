/**
 * Map a common image MIME type to its canonical file extension.
 * Falls back to `.png` for unknown types.
 */
export function mimeToImageExt(mime: string): string {
	if (mime === "image/png") return ".png"
	if (mime === "image/jpeg") return ".jpg"
	if (mime === "image/webp") return ".webp"
	return ".png"
}
