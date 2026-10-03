import type { CSSProperties } from "react"

export type IntrinsicBounds = {
	readonly maxWidth?: number
	readonly maxHeight?: number
	readonly minHeight?: number
	readonly minWidth?: number
	/** Cap the height at `maxHeight`, never a target — scale down only. */
	readonly fitHeight?: boolean
	/** Cap the width at `maxWidth`, never a target — scale down only. */
	readonly fitWidth?: boolean
}

/** Pixel bounds shared by the cover and its card. */
export function buildIntrinsicStyle(
	width: number | undefined,
	height: number | undefined,
	bounds: IntrinsicBounds,
): CSSProperties {
	const maxW = bounds.maxWidth ?? Number.POSITIVE_INFINITY
	const maxH = bounds.maxHeight ?? Number.POSITIVE_INFINITY
	if (bounds.fitHeight === true) {
		if (Number.isFinite(maxH)) {
			if (width !== undefined && height !== undefined && height > 0) {
				// The cap is a ceiling, never a target — only taller covers
				// scale down, shorter ones keep their natural height. Past
				// `maxWidth` the width clamp wins and the height rescales
				// proportionally, so ultra-wide covers stay bounded.
				const scale = Math.min(1, maxH / height)
				let fittedWidth = Math.round(width * scale)
				let fittedHeight = Math.round(height * scale)
				if (fittedWidth > maxW) {
					fittedWidth = maxW
					fittedHeight = Math.round((height / width) * maxW)
				}
				return { width: fittedWidth, height: fittedHeight }
			}
			// No cover metadata: fall back to the configured height so the
			// tile keeps the strip's rhythm instead of collapsing.
			return { width: maxH, height: maxH }
		}
	} else if (bounds.fitWidth === true) {
		if (Number.isFinite(maxW)) {
			if (width !== undefined && height !== undefined && height > 0) {
				// The mirror of fit-height: only wider covers scale down,
				// narrower ones keep their natural width. Past `maxHeight`
				// the height clamp wins and the width rescales, so
				// ultra-tall covers stay bounded.
				const scale = Math.min(1, maxW / width)
				let fittedWidth = Math.round(width * scale)
				let fittedHeight = Math.round(height * scale)
				if (fittedHeight > maxH) {
					fittedHeight = maxH
					fittedWidth = Math.round((width / height) * maxH)
				}
				return { width: fittedWidth, height: fittedHeight }
			}
			// No cover metadata: fall back to the configured width so the
			// tile keeps the column's rhythm instead of collapsing.
			return { width: maxW, height: maxW }
		}
	} else if (width !== undefined && height !== undefined && height > 0) {
		if (Number.isFinite(maxW) && Number.isFinite(maxH)) {
			const scale = Math.min(maxW / width, maxH / height, 1)
			return { width: width * scale, height: height * scale }
		}
	}
	return {
		minHeight: bounds.minHeight,
		minWidth: bounds.minWidth,
		maxHeight: Number.isFinite(maxH) ? maxH : undefined,
	}
}
