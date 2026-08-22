import { describe, expect, test } from "vitest"
import { character } from "./char.ts"

const valid = {
	id: "chr_1",
	name: "Alice",
	intro: "hi",
	tagIds: [],
	traitValues: {},
	createdAt: 1,
	updatedAt: 2,
} as const

describe("character schema", () => {
	test("parses a valid character", () => {
		expect(character.parse(valid).name).toBe("Alice")
	})

	test("rejects name > 512 chars", () => {
		expect(
			character.safeParse({ ...valid, name: "a".repeat(513) }).success,
		).toBe(false)
	})

	test("traitValues defaults to {}", () => {
		const { traitValues, ...rest } = valid
		void traitValues
		expect(character.parse(rest).traitValues).toEqual({})
	})

	test("accepts imageMeta slots", () => {
		expect(
			character.parse({
				...valid,
				imageMeta: {
					avatar: { empty: true },
					fullbody: { kind: "image", width: 4, height: 8 },
				},
			}).imageMeta,
		).toEqual({
			avatar: { empty: true },
			fullbody: { kind: "image", width: 4, height: 8 },
		})
	})
})
