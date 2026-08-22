/**
 * @vitest-environment node
 */

import type { TFunction } from "i18next"
import { describe, expect, it } from "vitest"
import type { TagSiblingGroup } from "@/features/tags/api"
import type { TagWithCounts } from "../panelModel"
import { effectiveTagCounts, tagRowLabel } from "./tagRowLabel"

const tag = (id: string, catId: string): TagWithCounts => ({
	id,
	name: id,
	intro: "",
	color: "",
	position: 0,
	pinned: false,
	catId,
	displayTagId: id,
	createdAt: 0,
	updatedAt: 0,
	resCount: 3,
	charCount: 2,
})

const group: TagSiblingGroup = {
	displayTagId: "d",
	memberTagIds: ["m", "d"],
	memberCharacters: [],
	resCount: 9,
	charCount: 7,
}

const t = ((key: string, opts?: { count?: number; name?: string }) => {
	if (key === "tags.rules.displaysAs") return `Shows as ${opts?.name ?? "?"}`
	if (key === "categories.panel.tagResourceCount") return `res ${opts?.count}`
	if (key === "categories.panel.tagCharacterCount") return `char ${opts?.count}`
	return key
}) as TFunction

describe("tagRowLabel", () => {
	it("labels a sibling member with its display badge", () => {
		const member = { ...tag("m", "c"), displayTagId: "d" }
		expect(tagRowLabel(member, "common", group, "Display", t)).toEqual({
			name: "Shows as Display",
		})
	})

	it("labels a display tag with its group's union counts", () => {
		const display = tag("d", "c")
		const label = tagRowLabel(display, "common", group, "Display", t)
		expect(label.name).toBe("d")
		expect(label.suffix).toContain("res 9")
		expect(label.suffix).toContain("char 7")
	})

	it("labels an ungrouped tag with its own counts", () => {
		const label = tagRowLabel(tag("lone", "c"), "common", undefined, "lone", t)
		expect(label.name).toBe("lone")
		expect(label.suffix).toContain("res 3")
		expect(label.suffix).toContain("char 2")
	})
})

describe("effectiveTagCounts", () => {
	it("gives a display tag its group's union counts", () => {
		const effective = effectiveTagCounts(tag("d", "c"), group)
		expect(effective.resCount).toBe(9)
		expect(effective.charCount).toBe(7)
	})

	it("keeps a member's own counts", () => {
		const member = { ...tag("m", "c"), displayTagId: "d" }
		expect(effectiveTagCounts(member, group).resCount).toBe(3)
	})

	it("keeps counts when there is no group", () => {
		expect(effectiveTagCounts(tag("lone", "c"), undefined).resCount).toBe(3)
	})
})
