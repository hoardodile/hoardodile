/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import {
	captureBounds,
	type DisplayRect,
	type ResolveBoundsLimits,
	resolveInitialBounds,
} from "./window-state.ts"

const LIMITS: ResolveBoundsLimits = {
	minWidth: 800,
	minHeight: 560,
	defaultWidth: 1440,
	defaultHeight: 1080,
}

// Two monitors: a 1920×1080 laptop at the origin and a 2560×1440 to its right.
const DISPLAYS: readonly DisplayRect[] = [
	{ x: 0, y: 0, width: 1920, height: 1080 },
	{ x: 1920, y: 0, width: 2560, height: 1440 },
]

describe("resolveInitialBounds", () => {
	it("uses the defaults when nothing was saved", () => {
		expect(resolveInitialBounds(null, DISPLAYS, LIMITS)).toEqual({
			width: 1440,
			height: 1080,
		})
	})

	it("keeps a saved size/position that fits a current display", () => {
		const saved = { x: 100, y: 80, width: 1200, height: 700 }
		expect(resolveInitialBounds(saved, DISPLAYS, LIMITS)).toEqual(saved)
	})

	it("keeps a window on the secondary monitor", () => {
		const saved = { x: 2000, y: 120, width: 1000, height: 800 }
		expect(resolveInitialBounds(saved, DISPLAYS, LIMITS)).toEqual(saved)
	})

	it("raises a window below the minimum size", () => {
		const result = resolveInitialBounds(
			{ x: 0, y: 0, width: 320, height: 200 },
			DISPLAYS,
			LIMITS,
		)
		expect(result.width).toBe(800)
		expect(result.height).toBe(560)
		expect(result.x).toBe(0)
		expect(result.y).toBe(0)
	})

	it("caps a window to the anchor display's work area", () => {
		const saved = { x: 100, y: 100, width: 3000, height: 2000 }
		const result = resolveInitialBounds(saved, DISPLAYS, LIMITS)
		expect(result.width).toBe(1920)
		expect(result.height).toBe(1080)
		// Clamped back inside the anchor display (a 3000-wide window on a
		// 1920 screen can only start at x=0).
		expect(result.x).toBe(0)
		expect(result.y).toBe(0)
	})

	it("drops the position when the saved window is off-screen (monitor unplugged)", () => {
		const result = resolveInitialBounds(
			{ x: 5000, y: 5000, width: 1200, height: 700 },
			DISPLAYS,
			LIMITS,
		)
		expect(result).toEqual({ width: 1200, height: 700 })
		expect(result.x).toBeUndefined()
		expect(result.y).toBeUndefined()
	})

	it("drops the position and caps the size for an off-screen oversized window", () => {
		const result = resolveInitialBounds(
			{ x: 10000, y: 10000, width: 4000, height: 2000 },
			DISPLAYS,
			LIMITS,
		)
		expect(result).toEqual({ width: 2560, height: 1440 })
	})

	it("drops the position when x/y are unknown", () => {
		expect(
			resolveInitialBounds(
				{ x: null, y: null, width: 1100, height: 640 },
				DISPLAYS,
				LIMITS,
			),
		).toEqual({ width: 1100, height: 640 })
	})

	it("clamps a window that overhangs the anchor display into its work area", () => {
		// 100 + 1900 = 2000 > 1920: the saved window would overhang the
		// anchor display, so x is pulled in while y stays put.
		const result = resolveInitialBounds(
			{ x: 100, y: 50, width: 1900, height: 1000 },
			DISPLAYS,
			LIMITS,
		)
		expect(result.x).toBe(1920 - 1900)
		expect(result.y).toBe(50)
		expect(result.width).toBe(1900)
		expect(result.height).toBe(1000)
	})

	it("ignores an empty display list and just clamps to minimums", () => {
		expect(
			resolveInitialBounds({ x: 5, y: 5, width: 300, height: 200 }, [], LIMITS),
		).toEqual({ width: 800, height: 560 })
	})

	it("drops the position when only one coordinate is known", () => {
		expect(
			resolveInitialBounds(
				{ x: 100, y: null, width: 1100, height: 640 },
				DISPLAYS,
				LIMITS,
			),
		).toEqual({ width: 1100, height: 640 })
	})

	it("clamps a straddling window to its anchor display (no teleport)", () => {
		// Top-left on display 1, right edge overhanging into display 2 —
		// the window stays on display 1, just clamped.
		const result = resolveInitialBounds(
			{ x: 1900, y: 100, width: 800, height: 700 },
			DISPLAYS,
			LIMITS,
		)
		expect(result.x).toBe(1920 - 800)
		expect(result.width).toBe(800)
		expect(result.height).toBe(700)
	})

	it("a work area smaller than the minimum keeps the minimum and left-aligns", () => {
		// Pathological display: the window is still created at min size
		// (BrowserWindow enforces it via minWidth/minHeight) and is
		// left-aligned instead of getting a negative offset.
		const result = resolveInitialBounds(
			{ x: 20, y: 30, width: 400, height: 300 },
			[{ x: 0, y: 0, width: 640, height: 480 }],
			LIMITS,
		)
		expect(result.width).toBe(800)
		expect(result.height).toBe(560)
		expect(result.x).toBe(0)
		expect(result.y).toBe(0)
	})

	it("size exactly at the minimum against a matching work area is kept", () => {
		expect(
			resolveInitialBounds(
				{ x: 0, y: 0, width: 800, height: 560 },
				[{ x: 0, y: 0, width: 800, height: 560 }],
				LIMITS,
			),
		).toEqual({ x: 0, y: 0, width: 800, height: 560 })
	})
})

describe("captureBounds", () => {
	it("reads the normal bounds even when the window is maximized", () => {
		const win = {
			getNormalBounds: () => ({ x: 240, y: 160, width: 1280, height: 720 }),
		}
		expect(captureBounds(win)).toEqual({
			x: 240,
			y: 160,
			width: 1280,
			height: 720,
		})
	})
})
