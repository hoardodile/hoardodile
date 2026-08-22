import { describe, expect, test } from "vitest"
import {
	charImageMeta,
	EMPTY_CHAR_IMAGE_META,
	EMPTY_IMAGE_SLOT,
	imageSlotHasFile,
	imageSlotMeta,
	isEmptyMeta,
} from "./image-meta.ts"

describe("emptyMeta / imageSlotMeta", () => {
	test("isEmptyMeta accepts the sentinel and rejects populated slots", () => {
		expect(isEmptyMeta(EMPTY_IMAGE_SLOT)).toBe(true)
		expect(isEmptyMeta({ empty: true })).toBe(true)
		expect(isEmptyMeta({ kind: "image", width: 10, height: 10 })).toBe(false)
		expect(isEmptyMeta(undefined)).toBe(false)
		expect(isEmptyMeta(null)).toBe(false)
	})

	test("imageSlotHasFile tri-state", () => {
		expect(imageSlotHasFile(undefined)).toBeUndefined()
		expect(imageSlotHasFile(EMPTY_IMAGE_SLOT)).toBe(false)
		expect(imageSlotHasFile({ kind: "image" })).toBe(true)
		expect(imageSlotHasFile({ kind: "image", width: 8, height: 8 })).toBe(true)
	})

	test("parses empty and populated slots", () => {
		expect(imageSlotMeta.parse(EMPTY_IMAGE_SLOT)).toEqual({ empty: true })
		expect(
			imageSlotMeta.parse({ kind: "image", width: 12, height: 8 }),
		).toEqual({ kind: "image", width: 12, height: 8 })
	})

	test("charImageMeta empty both slots is the create default", () => {
		expect(charImageMeta.parse(EMPTY_CHAR_IMAGE_META)).toEqual({
			avatar: { empty: true },
			fullbody: { empty: true },
		})
	})
})
