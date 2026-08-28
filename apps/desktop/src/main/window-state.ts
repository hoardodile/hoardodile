import type { BrowserWindow } from "electron"
import type { WindowBounds } from "./config.ts"

/**
 * Window-bounds restore/capture helpers (main process, pure where
 * possible). The persisted window state is `WindowBounds` + a separate
 * maximized flag; restoring re-validates against the CURRENT display
 * layout — a monitor may have been unplugged or rescaled since the last
 * capture, and a window opened off-screen must never happen.
 *
 * All coordinates are DIP (Electron's native unit), matching the values
 * stored in desktop.json.
 */

/** A display rect in DIP; `workArea` is the usable screen (taskbar excluded). */
export type DisplayRect = {
	readonly x: number
	readonly y: number
	readonly width: number
	readonly height: number
}

export type ResolveBoundsLimits = {
	readonly minWidth: number
	readonly minHeight: number
	readonly defaultWidth: number
	readonly defaultHeight: number
}

export type ResolvedBounds = {
	readonly width: number
	readonly height: number
	readonly x?: number
	readonly y?: number
}

/**
 * Turn persisted bounds into the BrowserWindow constructor's size/position:
 *
 * - `null` saved state → the window-kind defaults.
 * - size clamped to `[min, the anchor display's work area]` so a window
 *   saved on a bigger (or removed) monitor never comes back oversized;
 * - x/y kept only when the saved window's center lands on a current
 *   display (otherwise the position is dropped and the window centers);
 * - position additionally clamped into the anchor work area.
 */
export function resolveInitialBounds(
	saved: WindowBounds | null,
	displays: readonly DisplayRect[],
	limits: ResolveBoundsLimits,
): ResolvedBounds {
	if (saved === null) {
		return { width: limits.defaultWidth, height: limits.defaultHeight }
	}
	const anchor =
		saved.x !== null && saved.y !== null
			? anchorDisplay(saved, displays)
			: undefined
	const cap = anchor ?? largestWorkArea(displays)
	const width = clamp(
		saved.width,
		limits.minWidth,
		cap === undefined ? null : cap.width,
	)
	const height = clamp(
		saved.height,
		limits.minHeight,
		cap === undefined ? null : cap.height,
	)
	if (anchor === undefined) {
		return { width, height }
	}
	return {
		x: clampToRange(saved.x!, anchor.x, anchor.x + anchor.width - width),
		y: clampToRange(saved.y!, anchor.y, anchor.y + anchor.height - height),
		width,
		height,
	}
}

/** The display under the saved window's top-left (center as fallback). */
function anchorDisplay(
	saved: WindowBounds,
	displays: readonly DisplayRect[],
): DisplayRect | undefined {
	const topLeft = displays.find((display) =>
		contains(display, saved.x!, saved.y!),
	)
	if (topLeft !== undefined) return topLeft
	const centerX = saved.x! + saved.width / 2
	const centerY = saved.y! + saved.height / 2
	return displays.find((display) => contains(display, centerX, centerY))
}

/** The biggest work area (save target when no display holds the window). */
function largestWorkArea(
	displays: readonly DisplayRect[],
): DisplayRect | undefined {
	let largest: DisplayRect | undefined
	for (const display of displays) {
		if (
			largest === undefined ||
			display.width * display.height > largest.width * largest.height
		) {
			largest = display
		}
	}
	return largest
}

function contains(rect: DisplayRect, x: number, y: number): boolean {
	return (
		x >= rect.x &&
		x < rect.x + rect.width &&
		y >= rect.y &&
		y < rect.y + rect.height
	)
}

function clamp(value: number, min: number, max: number | null): number {
	if (max !== null && value > max) return max
	return Math.max(min, value)
}

function clampToRange(value: number, min: number, max: number): number {
	// A window larger than the work area must not get a negative offset —
	// left-align it instead (the min-size clamp wins over the area, and
	// BrowserWindow enforces minWidth/minHeight anyway).
	const upper = Math.max(min, max)
	return Math.max(min, Math.min(value, upper))
}

/**
 * The normal-state window bounds for persistence. On Windows/macOS the
 * window may be maximized or fullscreen while this reads the bounds the
 * window returns to after un-maximizing (`getNormalBounds`), so the
 * stored size never inflates to the screen.
 */
export function captureBounds(
	win: Pick<BrowserWindow, "getNormalBounds">,
): WindowBounds {
	const bounds = win.getNormalBounds()
	return {
		x: bounds.x,
		y: bounds.y,
		width: bounds.width,
		height: bounds.height,
	}
}
