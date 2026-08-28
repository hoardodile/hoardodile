/**
 * Display-size contract for the tag hover preview card artwork, in CSS
 * pixels. The thumb is scaled proportionally into the clamp window:
 * artwork smaller than `min` is upscaled to the floor (a 4×4 logo stays
 * recognisable), artwork larger than `max` is downscaled to the ceiling
 * (an 8K banner never blows the card out). `imageMeta.width/height` —
 * already shipped with the tag list — seeds the size before the browser
 * reports the rendered thumb's natural dimensions; the two must stay
 * consistent, so tweak both when either changes.
 */
export const TAG_HOVER_IMAGE_MIN = { width: 64, height: 64 } as const
export const TAG_HOVER_IMAGE_MAX = { width: 240, height: 200 } as const
/** The card never outgrows this (intro text, link row). */
export const TAG_HOVER_CARD_MAX_WIDTH = 280

export type DisplaySize = { readonly width: number; readonly height: number }

/** Scale `w×h` proportionally into the `[min, max]` clamp window. */
export function clampDisplaySize(w: number, h: number): DisplaySize {
	if (w <= 0 || h <= 0) return TAG_HOVER_IMAGE_MAX
	const { width: minW, height: minH } = TAG_HOVER_IMAGE_MIN
	const { width: maxW, height: maxH } = TAG_HOVER_IMAGE_MAX
	// Fit into the max box first (scale down only where needed), then
	// scale up to the min box when the artwork is smaller than the floor.
	let scale = Math.min(maxW / w, maxH / h)
	if (scale > 1) {
		scale = Math.max(minW / w, minH / h)
	}
	return {
		width: Math.round(w * scale),
		height: Math.round(h * scale),
	}
}
