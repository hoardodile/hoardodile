/**
 * @vitest-environment node
 */

import type { Tag } from "@hoardodile/schemas"
import { describe, expect, it } from "vitest"
import { collapseTags } from "./collapse"

function makeTag(id: string, catId: string, displayTagId = id): Tag {
	return {
		id,
		name: id,
		intro: "",
		color: "",
		position: 0,
		pinned: false,
		catId,
		displayTagId,
		createdAt: 0,
		updatedAt: 0,
	}
}

describe("collapseTags", () => {
	const memberA = makeTag("a", "cat1", "d")
	const memberB = makeTag("b", "cat2", "d")
	const display = makeTag("d", "cat1")
	const lone = makeTag("lone", "cat3")

	it("replaces members with their display row", () => {
		const byId = new Map(
			[memberA, memberB, display, lone].map((t) => [t.id, t]),
		)
		const collapsed = collapseTags([memberA, lone], byId)
		expect(collapsed.map((t) => t.id)).toEqual(["d", "lone"])
		// The display row itself is returned (name/catId from the display).
		expect(collapsed[0]).toEqual(display)
	})

	it("deduplicates several members of one group", () => {
		const byId = new Map([memberA, memberB, display].map((t) => [t.id, t]))
		const collapsed = collapseTags([memberA, memberB], byId)
		expect(collapsed.map((t) => t.id)).toEqual(["d"])
	})

	it("keeps first occurrence order", () => {
		const byId = new Map([memberA, memberB, display].map((t) => [t.id, t]))
		const collapsed = collapseTags([lone, memberB, memberA], byId)
		expect(collapsed.map((t) => t.id)).toEqual(["lone", "d"])
	})

	it("leaves an ungrouped list untouched", () => {
		const byId = new Map([lone].map((t) => [t.id, t]))
		expect(collapseTags([lone], byId)).toEqual([lone])
	})
})
