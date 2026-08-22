import { AUDIO_EXTS, VIDEO_EXTS } from "@hoardodile/sdk-types/media-exts"

/**
 * Classify a file extension (with leading dot, lower-cased) into its
 * media type using the canonical extension sets. Unknown / image
 * extensions default to `"image"`.
 */
export function extToMediaType(ext: string): "image" | "video" | "audio" {
	const e = ext.toLowerCase()
	if (VIDEO_EXTS.has(e)) return "video"
	if (AUDIO_EXTS.has(e)) return "audio"
	return "image"
}
