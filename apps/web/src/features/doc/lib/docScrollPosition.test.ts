import { describe, expect, it } from "vitest"
import {
	type DocScrollPosition,
	readDocScrollPosition,
	writeDocScrollPosition,
} from "./docScrollPosition"

const position: DocScrollPosition = {
	docId: "doc-1",
	blockId: "block-42",
	offset: 204,
	updatedAtMs: 123456789,
}

describe("doc scroll position storage", () => {
	it("round-trips a position", () => {
		writeDocScrollPosition(position)
		expect(readDocScrollPosition()).toEqual(position)
	})

	it("returns undefined when nothing was stored", () => {
		expect(readDocScrollPosition()).toBeUndefined()
	})

	it("returns undefined for invalid JSON", () => {
		localStorage.setItem("document.lastScroll", "{nope")
		expect(readDocScrollPosition()).toBeUndefined()
	})

	it("rejects malformed shapes", () => {
		const cases = [
			null,
			"string",
			{},
			{ docId: "d", blockId: "b", offset: 10 },
			{ docId: "d", blockId: "b", offset: "10", updatedAtMs: 1 },
			{ docId: 1, blockId: "b", offset: 10, updatedAtMs: 1 },
			{ docId: "d", blockId: "b", offset: 10, updatedAtMs: "1" },
		]
		for (const value of cases) {
			localStorage.setItem("document.lastScroll", JSON.stringify(value))
			expect(readDocScrollPosition()).toBeUndefined()
		}
	})
})
