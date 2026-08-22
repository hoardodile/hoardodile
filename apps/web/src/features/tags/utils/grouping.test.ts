/**
 * @vitest-environment node
 */

import type { Category, CatKind, Tag } from "@hoardodile/schemas"
import { describe, expect, it } from "vitest"
import {
	buildSelectedTagGroups,
	filterCategoriesByKind,
	groupTagsByCategory,
} from "./grouping"

function makeCategory(id: string, kind: CatKind, position: number): Category {
	return {
		id,
		name: id,
		intro: "",
		color: "",
		kind,
		position,
		pinned: false,
		createdAt: 0,
		updatedAt: 0,
	}
}

function makeTag(id: string, catId: string, position: number): Tag {
	return {
		id,
		name: id,
		intro: "",
		color: "",
		position,
		pinned: false,
		catId,
		displayTagId: id,
		createdAt: 0,
		updatedAt: 0,
	}
}

describe("filterCategoriesByKind", () => {
	const categories = [
		makeCategory("res1", "resource", 1),
		makeCategory("char1", "character", 2),
		makeCategory("common1", "common", 0),
	]

	it("returns all categories sorted by position when kind is undefined", () => {
		const result = filterCategoriesByKind(categories, undefined)
		expect(result.map((c) => c.id)).toEqual(["common1", "res1", "char1"])
	})

	it("returns only common categories when kind is common", () => {
		const result = filterCategoriesByKind(categories, "common")
		expect(result.map((c) => c.id)).toEqual(["common1"])
	})

	it("returns kind plus common categories for specific kinds", () => {
		const result = filterCategoriesByKind(categories, "resource")
		expect(result.map((c) => c.id)).toEqual(["common1", "res1"])
	})

	it("does not mutate the input", () => {
		const before = categories.map((c) => c.id)
		filterCategoriesByKind(categories, "resource")
		expect(categories.map((c) => c.id)).toEqual(before)
	})
})

describe("groupTagsByCategory", () => {
	it("groups tags by catId", () => {
		const map = groupTagsByCategory([
			makeTag("t1", "catA", 1),
			makeTag("t2", "catB", 0),
			makeTag("t3", "catA", 0),
		])
		expect(Array.from(map.keys()).sort()).toEqual(["catA", "catB"])
		expect(map.get("catA")?.map((t) => t.id)).toEqual(["t3", "t1"])
		expect(map.get("catB")?.map((t) => t.id)).toEqual(["t2"])
	})

	it("returns an empty map when input is empty", () => {
		expect(groupTagsByCategory([]).size).toBe(0)
	})
})

describe("buildSelectedTagGroups", () => {
	const categories = [
		makeCategory("c1", "resource", 0),
		makeCategory("c2", "resource", 1),
	]
	const tags = [
		makeTag("t1", "c1", 0),
		makeTag("t2", "c1", 1),
		makeTag("t3", "c2", 0),
	]

	it("groups selected tags under their category, preserving category order", () => {
		const groups = buildSelectedTagGroups(
			categories,
			tags,
			new Set(["t1", "t3"]),
		)
		expect(groups.map((g) => g.category.id)).toEqual(["c1", "c2"])
		expect(groups[0]?.tags.map((t) => t.id)).toEqual(["t1"])
	})

	it("omits categories with no selected tags", () => {
		const groups = buildSelectedTagGroups(categories, tags, new Set(["t1"]))
		expect(groups.map((g) => g.category.id)).toEqual(["c1"])
	})

	it("returns empty array when nothing is selected", () => {
		const groups = buildSelectedTagGroups(categories, tags, new Set())
		expect(groups).toEqual([])
	})
})
