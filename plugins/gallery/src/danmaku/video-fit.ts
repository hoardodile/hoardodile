import type { CSSProperties } from "react"
import { DEFAULT_VIDEO_ASPECT, type FitMode } from "./types"

/**
 * How the `<video>` element is sized inside the player frame. Pure so
 * the two fit modes can be reasoned about (and tested) without a
 * player: `contain` letterboxes to fill, `natural` caps the element at
 * the source resolution so low-res clips are never upscaled.
 */
export type VideoSize = { readonly w: number; readonly h: number }

export type VideoFitLayout = {
	readonly className: string
	readonly style: CSSProperties
}

export function resolveVideoFit(opts: {
	readonly fitMode: FitMode
	/** Source resolution, known only after `loadedmetadata`. */
	readonly natural: VideoSize | undefined
	/** Probed dimensions from `sourceMeta`, available on first paint. */
	readonly naturalSize: VideoSize | undefined
}): VideoFitLayout {
	const { fitMode, natural, naturalSize } = opts
	if (fitMode === "natural" && natural !== undefined) {
		return {
			className: "block h-auto w-auto object-contain",
			style: {
				maxWidth: `min(100%, ${natural.w}px)`,
				maxHeight: `min(100%, ${natural.h}px)`,
				aspectRatio: `${natural.w} / ${natural.h}`,
			},
		}
	}
	return {
		className: "block h-full w-full object-contain",
		style: { aspectRatio: initialAspectRatio(naturalSize) },
	}
}

/**
 * Aspect ratio to reserve before the browser decodes the first frame.
 * Falling back to 16:9 keeps the surface from collapsing and then
 * jumping once real dimensions arrive.
 */
export function initialAspectRatio(size: VideoSize | undefined): string {
	return size === undefined
		? `${DEFAULT_VIDEO_ASPECT}`
		: `${size.w} / ${size.h}`
}

/** Source resolution of a loaded video, or `undefined` before decode. */
export function readNaturalSize(
	video: HTMLVideoElement,
): VideoSize | undefined {
	if (video.videoWidth <= 0 || video.videoHeight <= 0) return undefined
	return { w: video.videoWidth, h: video.videoHeight }
}
