// @vitest-environment node
import { describe, expect, test } from "vitest"
import {
	clampViewportScale,
	isTapGesture,
	panViewport,
	type ViewportTransform,
	zoomViewportAt,
} from "./use-pinch-pan"

const RANGE = { minScale: 0.5, maxScale: 4 }

describe("viewport transform math", () => {
	test("clamps zoom into the viewer range", () => {
		expect(clampViewportScale(8, RANGE)).toBe(4)
		expect(clampViewportScale(0.1, RANGE)).toBe(0.5)
		expect(clampViewportScale(1.5, RANGE)).toBe(1.5)
	})

	test("pans by screen-space pixels", () => {
		const start: ViewportTransform = { x: 10, y: -4, scale: 2 }
		expect(panViewport(start, { x: 5, y: 7 })).toEqual({
			x: 15,
			y: 3,
			scale: 2,
		})
	})

	test("zooms while keeping the anchor point fixed", () => {
		const start: ViewportTransform = { x: 10, y: 20, scale: 1 }
		expect(zoomViewportAt(start, { x: 40, y: -10 }, 2, RANGE)).toEqual({
			x: -30,
			y: 30,
			scale: 2,
		})
	})

	test("a move within the threshold is a tap", () => {
		expect(isTapGesture({ x: 0, y: 0 }, { x: 5, y: 5 }, 8)).toBe(true)
		expect(isTapGesture({ x: 0, y: 0 }, { x: 8, y: 0 }, 8)).toBe(false)
	})
})
