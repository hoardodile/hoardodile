import { describe, expect, test } from "vitest"
import { decodeAnchor } from "../anchor"

describe("decodeAnchor", () => {
	test("decodes a valid page index", () => {
		expect(decodeAnchor({ pageIndex: 3 })).toEqual({ pageIndex: 3 })
	})

	test("accepts a zero page index", () => {
		expect(decodeAnchor({ pageIndex: 0 })).toEqual({ pageIndex: 0 })
	})

	test("rejects non-objects", () => {
		expect(decodeAnchor(undefined)).toBeUndefined()
		expect(decodeAnchor(null)).toBeUndefined()
		expect(decodeAnchor(12)).toBeUndefined()
	})

	test("rejects missing or malformed pageIndex", () => {
		expect(decodeAnchor({})).toBeUndefined()
		expect(decodeAnchor({ pageIndex: "3" })).toBeUndefined()
		expect(decodeAnchor({ pageIndex: -1 })).toBeUndefined()
		expect(decodeAnchor({ pageIndex: 1.5 })).toBeUndefined()
		expect(decodeAnchor({ pageIndex: Number.NaN })).toBeUndefined()
	})
})
