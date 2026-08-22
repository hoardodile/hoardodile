// @vitest-environment node

import { describe, expect, it } from "vitest"
import { previewTimeAt } from "../danmaku/useScrubPreview"

describe("previewTimeAt", () => {
	it("maps the pointer ratio to the media timestamp", () => {
		expect(previewTimeAt(300, 100, 400, 10_000)).toBe(5_000)
	})

	it("returns 0 at the left edge and the duration at the right edge", () => {
		expect(previewTimeAt(100, 100, 400, 10_000)).toBe(0)
		expect(previewTimeAt(500, 100, 400, 10_000)).toBe(10_000)
	})

	it("clamps pointers outside the container", () => {
		expect(previewTimeAt(0, 100, 400, 10_000)).toBe(0)
		expect(previewTimeAt(900, 100, 400, 10_000)).toBe(10_000)
	})

	it("returns 0 for a degenerate container or duration", () => {
		expect(previewTimeAt(200, 0, 0, 10_000)).toBe(0)
		expect(previewTimeAt(200, 0, 400, 0)).toBe(0)
	})
})
