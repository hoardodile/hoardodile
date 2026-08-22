import { isRecord } from "@hoardodile/sdk-web"
import type { GalleryFile, GallerySourceMeta } from "./shared"

/**
 * First-paint preview hint written by the `sourceMeta` builder into the
 * resource's `sourceMeta.previews`: up to 3 {@link GalleryFile} entries
 * in natural sort order, available synchronously from `api.resource.sourceMeta`
 * before `api.useFileList()` resolves.
 */
export function readGalleryPreviews(
	meta: GallerySourceMeta | undefined,
): readonly GalleryFile[] | undefined {
	const raw = meta?.previews
	if (raw === undefined) return undefined
	return raw
}

export function readSourceMetaDimensions(meta: GallerySourceMeta | undefined): {
	readonly width?: number
	readonly height?: number
} {
	const width =
		meta?.width !== undefined && Number.isFinite(meta.width)
			? meta.width
			: undefined
	const height =
		meta?.height !== undefined && Number.isFinite(meta.height)
			? meta.height
			: undefined
	return { width, height }
}

function isMediaType(
	value: unknown,
): value is NonNullable<GalleryFile["type"]> {
	return value === "image" || value === "video" || value === "audio"
}

function optionalFiniteNumber(value: unknown): number | undefined {
	return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

function optionalBoolean(value: unknown): boolean | undefined {
	return typeof value === "boolean" ? value : undefined
}

/**
 * Coerce a host `listFiles` entry (bare filename string or metadata
 * object) into a {@link GalleryFile}. The wire format allows both;
 * reading `.filename` off a string yields `undefined` and the iframe
 * requests `/files/undefined`.
 */
export function toGalleryFile(entry: unknown): GalleryFile | undefined {
	if (typeof entry === "string") {
		return entry.length > 0 ? { filename: entry } : undefined
	}
	if (!isRecord(entry)) return undefined
	const filename = entry.filename
	if (typeof filename !== "string" || filename.length === 0) return undefined
	const file: {
		filename: string
		type?: GalleryFile["type"]
		width?: number
		height?: number
		durationMs?: number
		preview?: boolean
		hasCoverArt?: boolean
	} = { filename }
	if (isMediaType(entry.type)) file.type = entry.type
	const width = optionalFiniteNumber(entry.width)
	if (width !== undefined) file.width = width
	const height = optionalFiniteNumber(entry.height)
	if (height !== undefined) file.height = height
	const durationMs = optionalFiniteNumber(entry.durationMs)
	if (durationMs !== undefined) file.durationMs = durationMs
	const preview = optionalBoolean(entry.preview)
	if (preview !== undefined) file.preview = preview
	const hasCoverArt = optionalBoolean(entry.hasCoverArt)
	if (hasCoverArt !== undefined) file.hasCoverArt = hasCoverArt
	return file
}

/**
 * Normalize a `listFiles` payload. `undefined` means the query has not
 * resolved yet (callers keep `sourceMeta.previews`). An empty list is
 * a resolved empty payload, not a miss.
 */
export function normalizeGalleryFiles(
	entries: readonly unknown[] | undefined,
): readonly GalleryFile[] | undefined {
	if (entries === undefined) return undefined
	const out: GalleryFile[] = []
	for (const entry of entries) {
		const file = toGalleryFile(entry)
		if (file !== undefined) out.push(file)
	}
	return out
}
