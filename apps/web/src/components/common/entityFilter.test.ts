// @vitest-environment node
import { describe, expect, it } from "vitest"
import { matchesNameQuery } from "./entityFilter"

describe("matchesNameQuery", () => {
	it("matches everything on an empty or whitespace query", () => {
		expect(matchesNameQuery("Mood", "")).toBe(true)
		expect(matchesNameQuery("Mood", "   ")).toBe(true)
	})

	it("matches case-insensitively", () => {
		expect(matchesNameQuery("Age", "age")).toBe(true)
		expect(matchesNameQuery("Signature quote", "SIGN")).toBe(true)
	})

	it("rejects non-matches", () => {
		expect(matchesNameQuery("Age", "height")).toBe(false)
		expect(matchesNameQuery("Age", "zzz")).toBe(false)
	})
})
