import type { PluginSchema } from "@hoardodile/sdk-types"
import { isRecord } from "@hoardodile/sdk-web"

export type GalleryFile = {
	readonly filename: string
	readonly type?: "image" | "video" | "audio"
	readonly width?: number
	readonly height?: number
	readonly durationMs?: number
	readonly preview?: boolean
	/** Audio only: the file carries embedded artwork the host can extract. */
	readonly hasCoverArt?: boolean
}

export type GallerySourceMeta = {
	readonly previews?: readonly GalleryFile[]
	readonly width?: number
	readonly height?: number
	readonly durationMs?: number
}

export type GallerySearchMeta = {
	readonly v: number
	readonly facets?: {
		readonly image?: boolean
		readonly animation?: boolean
		readonly video?: boolean
		readonly audio?: boolean
	}
}

export interface GallerySchema extends PluginSchema {
	readonly file: GalleryFile
	readonly sourceMeta: GallerySourceMeta
	readonly searchMeta: GallerySearchMeta
	readonly anchor: VideoTimeAnchor
}

/** Danmaku anchor pinning a comment to a playback position of one file. */
export type VideoTimeAnchor = {
	readonly kind: "videoTime"
	readonly filename: string
	readonly timeMs: number
}

/** Validate incoming anchor data against {@link VideoTimeAnchor}. */
export function decodeVideoTimeAnchor(
	data: unknown,
): VideoTimeAnchor | undefined {
	if (!isRecord(data)) return undefined
	const { kind, filename, timeMs } = data
	if (
		kind !== "videoTime" ||
		typeof filename !== "string" ||
		typeof timeMs !== "number"
	) {
		return undefined
	}
	return { kind, filename, timeMs }
}
