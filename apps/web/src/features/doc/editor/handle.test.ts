/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { normalizeInitialBlocks } from "./handle"

describe("normalizeInitialBlocks", () => {
	it("returns undefined for an undefined payload so BlockNote falls back to its empty doc", () => {
		expect(normalizeInitialBlocks(undefined)).toBe(undefined)
	})

	it("returns undefined when the payload has no blocks array", () => {
		expect(normalizeInitialBlocks({})).toBe(undefined)
		expect(normalizeInitialBlocks({ blocks: "not-an-array" })).toBe(undefined)
	})

	it("returns the blocks array as-is when present", () => {
		const blocks = [{ type: "paragraph" }, { type: "heading" }]
		expect(normalizeInitialBlocks({ blocks })).toBe(blocks)
	})
})
