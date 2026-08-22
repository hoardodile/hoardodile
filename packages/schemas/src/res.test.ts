import { describe, expect, test } from "vitest"
import { resource } from "./res.ts"

const TEST_PLUGIN_ID = "665cfbdd-1db6-48f5-9d53-1008b8cb84c3"

const valid = {
	id: "01J0000000000000000000RES0",
	name: "Hello",
	intro: "",
	tagIds: [],
	charIds: [],
	contentPluginId: TEST_PLUGIN_ID,
	coverVersion: 1,
	createdAt: 0,
	updatedAt: 0,
	dislikeCount: 0,
	dislikedRecently: false,
} as const

describe("resource schema", () => {
	test("parses a valid resource", () => {
		const parsed = resource.parse(valid)
		expect(parsed.id).toBe(valid.id)
		expect(parsed.contentPluginId).toBe(TEST_PLUGIN_ID)
	})

	test("applies defaults for intro, tagIds, charIds", () => {
		const { intro, tagIds, charIds, ...rest } = valid
		void intro
		void tagIds
		void charIds
		const parsed = resource.parse(rest)
		expect(parsed.intro).toBe("")
		expect(parsed.tagIds).toEqual([])
		expect(parsed.charIds).toEqual([])
	})

	test("rejects empty name", () => {
		expect(resource.safeParse({ ...valid, name: "" }).success).toBe(false)
	})

	test("rejects invalid contentPluginId", () => {
		expect(
			resource.safeParse({ ...valid, contentPluginId: "not-a-uuid" }).success,
		).toBe(false)
	})

	test("accepts an optional previewPluginId and validates its format", () => {
		expect(resource.parse(valid).previewPluginId).toBeUndefined()
		const parsed = resource.parse({
			...valid,
			previewPluginId: TEST_PLUGIN_ID,
		})
		expect(parsed.previewPluginId).toBe(TEST_PLUGIN_ID)
		expect(
			resource.safeParse({ ...valid, previewPluginId: "not-a-uuid" }).success,
		).toBe(false)
	})

	test("accepts empty and populated coverMeta", () => {
		expect(
			resource.parse({ ...valid, coverMeta: { empty: true } }).coverMeta,
		).toEqual({ empty: true })
		expect(
			resource.parse({
				...valid,
				coverMeta: { kind: "image", width: 10, height: 8 },
			}).coverMeta,
		).toEqual({ kind: "image", width: 10, height: 8 })
	})
})
