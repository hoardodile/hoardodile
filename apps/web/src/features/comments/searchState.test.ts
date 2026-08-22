/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { COMMENT_SEARCH_DEFAULTS, commentSearchUrlSchema } from "./searchState"

describe("commentSearchUrlSchema", () => {
	it("parses entity filters and sort options from URL search", () => {
		const parsed = commentSearchUrlSchema.parse({
			charId: "char-1",
			resId: "res-1",
			query: "hello",
			sortBy: "mostLikes",
			trash: "true",
			page: "2",
		})
		expect(parsed).toEqual({
			charId: "char-1",
			resId: "res-1",
			query: "hello",
			sortBy: "mostLikes",
			trash: true,
			page: 2,
		})
	})

	it("merges with defaults for partial URLs", () => {
		const url = commentSearchUrlSchema.parse({ charId: "char-1" })
		const merged = { ...COMMENT_SEARCH_DEFAULTS, ...url }
		expect(merged.charId).toBe("char-1")
		expect(merged.sortBy).toBe("newest")
		expect(merged.page).toBe(1)
		expect(merged.trash).toBe(false)
	})
})
