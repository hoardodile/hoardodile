import { describe, expect, test } from "vitest"
import { pinnedTag, tag } from "./tag.ts"
import { MAX_URL_LENGTH } from "./text-limits.ts"

const valid = {
	id: "tag_1",
	name: "Red",
	intro: "",
	color: "#ff0000",
	position: 1,
	pinned: false,
	catId: "cat_1",
	displayTagId: "tag_1",
	createdAt: 0,
	updatedAt: 0,
} as const

describe("tag schema", () => {
	test("parses a valid tag", () => {
		expect(tag.parse(valid).name).toBe("Red")
	})

	test("rejects missing catId", () => {
		const { catId: _, ...rest } = valid
		expect(tag.safeParse(rest).success).toBe(false)
	})

	test("rejects missing displayTagId", () => {
		const { displayTagId: _, ...rest } = valid
		expect(tag.safeParse(rest).success).toBe(false)
	})

	test("rejects empty name", () => {
		expect(tag.safeParse({ ...valid, name: "" }).success).toBe(false)
	})

	test("rejects overly long color", () => {
		expect(tag.safeParse({ ...valid, color: "a".repeat(101) }).success).toBe(
			false,
		)
	})

	test("parses a rule-derived tag with the virtual flag", () => {
		expect(tag.parse({ ...valid, virtual: true }).virtual).toBe(true)
	})

	test("a real tag without the virtual flag parses to undefined virtual", () => {
		expect(tag.parse(valid).virtual).toBeUndefined()
	})

	test("rejects an overly long link", () => {
		expect(
			tag.safeParse({ ...valid, link: "a".repeat(MAX_URL_LENGTH + 1) }).success,
		).toBe(false)
	})

	test("parses the imageMeta slot projection", () => {
		const withMeta = tag.parse({
			...valid,
			link: "www.example.com/a",
			imageMeta: { kind: "image", width: 4, height: 8, source: "image.png" },
		})
		expect(withMeta.link).toBe("www.example.com/a")
		expect(withMeta.imageMeta).toEqual({
			kind: "image",
			width: 4,
			height: 8,
			source: "image.png",
		})

		const empty = tag.parse({ ...valid, imageMeta: { empty: true } })
		expect(empty.imageMeta).toEqual({ empty: true })

		const none = tag.parse(valid)
		expect(none.imageMeta).toBeUndefined()
	})
})

describe("pinnedTag schema", () => {
	test("parses a real pinned row without the virtual flag", () => {
		expect(pinnedTag.parse({ id: "tag_1", name: "Red", color: "" })).toEqual({
			id: "tag_1",
			name: "Red",
			color: "",
		})
		expect(
			pinnedTag.parse({ id: "tag_1", name: "Red", color: "" }).virtual,
		).toBe(undefined)
	})

	test("parses a rule-derived pinned row with virtual", () => {
		const row = pinnedTag.parse({
			id: "tag_2",
			name: "Blue",
			color: "#00f",
			virtual: true,
		})
		expect(row.virtual).toBe(true)
	})

	test("rejects an empty name", () => {
		expect(pinnedTag.safeParse({ id: "tag_3", name: "" }).success).toBe(false)
	})

	test("rejects a missing id", () => {
		expect(pinnedTag.safeParse({ name: "Red" }).success).toBe(false)
	})
})
