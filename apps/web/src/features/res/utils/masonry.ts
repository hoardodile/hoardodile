import type { ResCard } from "@hoardodile/schemas"
import { pickCoverKind, populatedCover } from "@hoardodile/schemas"
import {
	AUDIO_TILE_HEIGHT,
	buildIntrinsicStyle,
	CARD_MAX_HEIGHT_PX,
	CARD_MIN_HEIGHT_PX,
} from "./thumb-sizing"

/** Column width in px; card covers are capped at this (mirror of the list's
    `thumbFitWidth`). */
export const MASONRY_COLUMN_PX = 280
/** Horizontal gap between masonry columns, in px (matches the list `gap-6`). */
export const MASONRY_COLUMN_GAP_PX = 24
/** Approximate chrome height of a card below its thumbnail (name, chips, meta). */
export const MASONRY_CARD_CHROME_PX = 96

/**
 * Number of masonry columns for a container of `width` px: one 280px column
 * per full slot, at least one. Matches the CSS `columns-[280px]` threshold the
 * old layout used, so the card density is unchanged.
 */
export function masonryColumnCount(width: number): number {
	return Math.max(1, Math.floor(width / MASONRY_COLUMN_PX))
}

/**
 * Estimated rendered height of one card at the masonry column width. Derived
 * from the same bounds as the rendered cover, including its base height floor.
 * Plugin badges can grow the tile beyond this estimate.
 * A cover-less card falls back to a square tile. The small chrome allowance
 * is constant, so the estimate is deterministic for a given resource.
 */
export function estimateCardHeight(resource: ResCard): number {
	const cover = populatedCover(resource.coverMeta)
	const coverWidth = cover?.width
	const coverHeight = cover?.height
	const audioWithoutArtwork =
		pickCoverKind(resource.coverMeta) === "audio" &&
		(coverWidth === undefined || coverHeight === undefined)
	const fitted = buildIntrinsicStyle(coverWidth, coverHeight, {
		maxWidth: MASONRY_COLUMN_PX,
		maxHeight: CARD_MAX_HEIGHT_PX,
		fitWidth: true,
	})
	const thumbHeight = Math.max(
		CARD_MIN_HEIGHT_PX,
		audioWithoutArtwork
			? AUDIO_TILE_HEIGHT
			: typeof fitted.height === "number"
				? fitted.height
				: MASONRY_COLUMN_PX,
	)
	return thumbHeight + MASONRY_CARD_CHROME_PX + MASONRY_COLUMN_GAP_PX
}

/**
 * Distribute rows across `columnCount` columns so that each card lands in the
 * currently-shortest column (by estimated height), keeping every column
 * roughly balanced. The assignment is a pure function of `rows` in order, so
 * it is prefix-stable: appending rows never reassigns a row that is already
 * placed, which is what makes the masonry "append downward" instead of
 * reflowing the previous columns (the CSS `columns` problem).
 */
export function distributeMasonry(
	rows: readonly ResCard[],
	columnCount: number,
): ResCard[][] {
	const count = Math.max(1, columnCount)
	const heights = Array.from({ length: count }, () => 0)
	const columns = Array.from({ length: count }, () => [] as ResCard[])
	for (const row of rows) {
		let shortest = 0
		for (let i = 1; i < count; i += 1) {
			if ((heights[i] ?? 0) < (heights[shortest] ?? 0)) shortest = i
		}
		columns[shortest]?.push(row)
		heights[shortest] = (heights[shortest] ?? 0) + estimateCardHeight(row)
	}
	return columns
}
