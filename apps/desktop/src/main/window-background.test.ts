/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { windowBackgroundColor } from "./window-background.ts"

describe("windowBackgroundColor", () => {
	it("uses the mono light canvas", () => {
		expect(windowBackgroundColor(false)).toBe("#fbfbfb")
	})

	it("uses the mono dark canvas", () => {
		expect(windowBackgroundColor(true)).toBe("#060606")
	})
})
