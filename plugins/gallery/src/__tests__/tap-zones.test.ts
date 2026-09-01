// @vitest-environment node

import { describe, expect, it } from "vitest"
import {
	cursorForTapZone,
	exceedsTapTolerance,
	resolveTapZone,
} from "../tap-zones"

describe("resolveTapZone", () => {
	it("pages backwards on the left third and forwards on the right third", () => {
		expect(resolveTapZone(300, 10)).toBe("prev")
		expect(resolveTapZone(300, 290)).toBe("next")
	})

	it("swallows taps inside the centre third", () => {
		expect(resolveTapZone(300, 150)).toBe("center")
		expect(resolveTapZone(300, 101)).toBe("center")
		expect(resolveTapZone(300, 199)).toBe("center")
	})

	it("treats the centre band edges as neutral", () => {
		expect(resolveTapZone(300, 100)).toBe("center")
		expect(resolveTapZone(300, 200)).toBe("center")
		expect(resolveTapZone(300, 99)).toBe("prev")
		expect(resolveTapZone(300, 201)).toBe("next")
	})

	it("degenerates safely for a zero-width surface", () => {
		expect(resolveTapZone(0, 0)).toBe("center")
	})
})

describe("cursorForTapZone", () => {
	it("advertises the step zones as clickable and the centre band as neutral", () => {
		expect(cursorForTapZone("prev")).toBe("pointer")
		expect(cursorForTapZone("next")).toBe("pointer")
		expect(cursorForTapZone("center")).toBe("default")
	})
})

describe("exceedsTapTolerance", () => {
	it("keeps small jitter a tap", () => {
		expect(exceedsTapTolerance(8, 8)).toBe(false)
		expect(exceedsTapTolerance(-8, 0)).toBe(false)
	})

	it("treats real movement as a drag", () => {
		expect(exceedsTapTolerance(9, 0)).toBe(true)
		expect(exceedsTapTolerance(0, -9)).toBe(true)
	})
})
