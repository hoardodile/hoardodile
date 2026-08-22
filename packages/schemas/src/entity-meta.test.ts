import { describe, expect, it, test } from "vitest"
import {
	comparePinnedPositionName,
	entityMetaCreateInput,
	entityMetaReorderInput,
	entityMetaUpdateInput,
} from "./entity-meta.ts"
import { MAX_INTRO_LENGTH, MAX_NAME_LENGTH } from "./text-limits.ts"

type Item = {
	readonly pinned: boolean
	readonly position: number
	readonly name: string
}

function sort(items: readonly Item[]): readonly string[] {
	return items
		.slice()
		.sort(comparePinnedPositionName)
		.map((i) => i.name)
}

describe("comparePinnedPositionName", () => {
	it("places pinned items before unpinned", () => {
		expect(
			sort([
				{ pinned: false, position: 0, name: "a" },
				{ pinned: true, position: 5, name: "b" },
			]),
		).toEqual(["b", "a"])
	})

	it("orders by `position` within the same pinned bucket", () => {
		expect(
			sort([
				{ pinned: true, position: 2, name: "x" },
				{ pinned: true, position: 0, name: "y" },
				{ pinned: true, position: 1, name: "z" },
			]),
		).toEqual(["y", "z", "x"])
	})

	it("falls back to alphabetic name within the same position", () => {
		expect(
			sort([
				{ pinned: false, position: 0, name: "banana" },
				{ pinned: false, position: 0, name: "apple" },
				{ pinned: false, position: 0, name: "cherry" },
			]),
		).toEqual(["apple", "banana", "cherry"])
	})

	it("sorts pinned first, then by position then name", () => {
		const sorted = [
			{ pinned: false, position: 0, name: "Beta" },
			{ pinned: true, position: 2, name: "Gamma" },
			{ pinned: false, position: 0, name: "Alpha" },
			{ pinned: true, position: 0, name: "Zeta" },
		].sort(comparePinnedPositionName)
		expect(sorted.map((item) => item.name)).toEqual([
			"Zeta",
			"Gamma",
			"Alpha",
			"Beta",
		])
	})
})

describe("entityMetaCreateInput", () => {
	const create = entityMetaCreateInput(MAX_NAME_LENGTH)

	test("accepts name only", () => {
		expect(create.safeParse({ name: "Test" }).success).toBe(true)
	})

	test("rejects empty name", () => {
		expect(create.safeParse({ name: "" }).success).toBe(false)
	})

	test("rejects intro over limit", () => {
		expect(
			create.safeParse({ name: "x", intro: "a".repeat(MAX_INTRO_LENGTH + 1) })
				.success,
		).toBe(false)
	})
})

describe("entityMetaUpdateInput", () => {
	const update = entityMetaUpdateInput(MAX_NAME_LENGTH)

	test("accepts id-only patch", () => {
		expect(update.safeParse({ id: "abc" }).success).toBe(true)
	})

	test("rejects missing id", () => {
		expect(update.safeParse({ name: "x" }).success).toBe(false)
	})
})

describe("entityMetaReorderInput", () => {
	test("accepts id list", () => {
		expect(entityMetaReorderInput.safeParse({ ids: ["a", "b"] }).success).toBe(
			true,
		)
	})
})
