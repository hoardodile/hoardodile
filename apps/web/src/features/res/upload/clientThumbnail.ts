import { IMAGE_EXTS, VIDEO_EXTS } from "@hoardodile/sdk-types/media-exts"

/**
 * Upload-side thumbnail helpers.
 *
 * Pre-upload preview generation has been removed; previews are now
 * synthesised server-side from staged files via
 * `GET /api/uploads/:uploadId/preview?fileId=<uuid>`.
 */

export function fileExt(name: string): string {
	const dot = name.lastIndexOf(".")
	if (dot < 0) return ""
	return name.slice(dot).toLowerCase()
}

export function isThumbnailable(file: File): boolean {
	return isImageFile(file) || isVideoFile(file)
}

export function isVideoFile(file: File): boolean {
	const ext = fileExt(file.name)
	if (VIDEO_EXTS.has(ext)) return true
	if (file.type.startsWith("video/")) return true
	return false
}

export function isImageFile(file: File): boolean {
	const ext = fileExt(file.name)
	if (IMAGE_EXTS.has(ext)) return true
	if (file.type.startsWith("image/")) return true
	return false
}

export function extensionLabel(fileName: string): string {
	const dot = fileName.lastIndexOf(".")
	if (dot < 0 || dot === fileName.length - 1) return "FILE"
	return fileName
		.slice(dot + 1)
		.toUpperCase()
		.slice(0, 4)
}
