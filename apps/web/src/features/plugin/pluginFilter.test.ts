// @vitest-environment node
import { describe, expect, it } from "vitest"
import { matchesPluginQuery } from "./pluginFilter"

const fields = {
	id: "665cfbdd-gallery",
	name: "Gallery",
	description: "Grid and immersive viewing for image collections.",
}

describe("matchesPluginQuery", () => {
	it("matches everything on an empty or whitespace query", () => {
		expect(matchesPluginQuery(fields, "")).toBe(true)
		expect(matchesPluginQuery(fields, "   ")).toBe(true)
	})

	it("matches name, id and description case-insensitively", () => {
		expect(matchesPluginQuery(fields, "gallery")).toBe(true)
		expect(matchesPluginQuery(fields, "GALL")).toBe(true)
		expect(matchesPluginQuery(fields, "665cfbdd-gallery")).toBe(true)
		expect(matchesPluginQuery(fields, "immersive")).toBe(true)
	})

	it("rejects non-matches", () => {
		expect(matchesPluginQuery(fields, "novel")).toBe(false)
		expect(matchesPluginQuery(fields, "zzz")).toBe(false)
	})
})
