/**
 * Tap-zone geometry for the image viewer: the left and right thirds
 * page backwards / forwards, and a safe centre band swallows the tap so
 * pinch-zoom and double-tap gestures are not hijacked.
 *
 * Framework-agnostic on purpose — the pointer handler and the hover
 * cursor both ask the same question ("which zone is this x in?"), and
 * before this they each rederived the centre band inline.
 */

/** Movement past this (px) turns a press into a drag, not a tap. */
export const TAP_MOVE_TOLERANCE_PX = 8
/** Share of the width reserved as a neutral centre band. */
const CENTER_SAFE_FRACTION = 1 / 3

export type TapZone = "prev" | "next" | "center"

export function resolveTapZone(width: number, offsetX: number): TapZone {
	const centerHalf = (width * CENTER_SAFE_FRACTION) / 2
	const middle = width / 2
	if (offsetX >= middle - centerHalf && offsetX <= middle + centerHalf) {
		return "center"
	}
	return offsetX < middle ? "prev" : "next"
}

/** CSS cursor advertising what a click in this zone would do. */
export function cursorForTapZone(zone: TapZone): string {
	// The prev/next step zones are clickable (pointer); the neutral centre
	// band is deliberately inert (default) so pinch-zoom is never misread
	// as a clickable link.
	return zone === "center" ? "default" : "pointer"
}

export function exceedsTapTolerance(
	dx: number,
	dy: number,
	tolerancePx: number = TAP_MOVE_TOLERANCE_PX,
): boolean {
	return Math.abs(dx) > tolerancePx || Math.abs(dy) > tolerancePx
}
