/**
 * Persisted whole-document zoom levels. Affects layout, images and inline
 * blocks uniformly so users can adapt content to small or oversized
 * displays.
 */
export const ZOOM_STEPS = [0.75, 0.875, 1, 1.125, 1.25, 1.5, 1.75, 2] as const

export const ZOOM_DEFAULT_INDEX = 2

export function clampZoomIndex(idx: number): number {
	if (idx < 0) return 0
	if (idx >= ZOOM_STEPS.length) return ZOOM_STEPS.length - 1
	return idx
}

export function zoomLevelAt(index: number): number {
	return ZOOM_STEPS[clampZoomIndex(index)] ?? 1
}
