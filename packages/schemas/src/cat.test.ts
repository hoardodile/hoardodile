import { describe, expect, test } from "vitest"
import { category } from "./cat.ts"

const valid = {
	id: "cat_1",
	name: "General",
	intro: "",
	kind: "common",
	position: 1,
	pinned: false,
	createdAt: 0,
	updatedAt: 0,
} as const

describe("category schema", () => {
	test("parses a valid category", () => {
		expect(category.parse(valid).name).toBe("General")
	})

	test("rejects non-integer position", () => {
		expect(category.safeParse({ ...valid, position: 1.5 }).success).toBe(false)
	})

	test("rejects unknown kind", () => {
		expect(category.safeParse({ ...valid, kind: "asset" }).success).toBe(false)
	})
})
