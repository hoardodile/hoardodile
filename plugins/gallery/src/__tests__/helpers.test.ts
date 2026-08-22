// @vitest-environment node

import { describe, expect, it } from "vitest"
import {
	normalizeGalleryFiles,
	readGalleryPreviews,
	readSourceMetaDimensions,
	toGalleryFile,
} from "../helpers"

describe("readGalleryPreviews", () => {
	it("returns undefined when meta is absent", () => {
		expect(readGalleryPreviews(undefined)).toBeUndefined()
	})

	it("returns empty array when previews is empty", () => {
		expect(readGalleryPreviews({ previews: [] })).toEqual([])
	})

	it("returns GalleryFile entries when previews use the new object format", () => {
		const previews = [
			{ filename: "01.jpg", type: "image" as const, preview: true },
			{ filename: "02.mp4", type: "video" as const, preview: false },
		]
		expect(readGalleryPreviews({ previews })).toEqual(previews)
	})
})

describe("readSourceMetaDimensions", () => {
	it("returns finite width and height when present", () => {
		expect(readSourceMetaDimensions({ width: 800, height: 600 })).toEqual({
			width: 800,
			height: 600,
		})
	})

	it("omits non-finite dimensions", () => {
		expect(
			readSourceMetaDimensions({
				width: Number.NaN,
				height: Number.POSITIVE_INFINITY,
			}),
		).toEqual({ width: undefined, height: undefined })
	})
})

describe("toGalleryFile", () => {
	it("wraps a non-empty string as filename", () => {
		expect(toGalleryFile("Van Gogh - Starry Night.jpg")).toEqual({
			filename: "Van Gogh - Starry Night.jpg",
		})
	})

	it("drops an empty string", () => {
		expect(toGalleryFile("")).toBeUndefined()
	})

	it("keeps object fields that match GalleryFile", () => {
		expect(
			toGalleryFile({
				filename: "01.jpg",
				type: "image",
				width: 1920,
				height: 1080,
				preview: true,
			}),
		).toEqual({
			filename: "01.jpg",
			type: "image",
			width: 1920,
			height: 1080,
			preview: true,
		})
	})

	it("drops objects without a filename", () => {
		expect(toGalleryFile({ type: "image" })).toBeUndefined()
		expect(toGalleryFile(null)).toBeUndefined()
		expect(toGalleryFile(1)).toBeUndefined()
	})
})

describe("normalizeGalleryFiles", () => {
	it("returns undefined when the query has not resolved", () => {
		expect(normalizeGalleryFiles(undefined)).toBeUndefined()
	})

	it("wraps a string-only list", () => {
		expect(normalizeGalleryFiles(["Van Gogh - Starry Night.jpg"])).toEqual([
			{ filename: "Van Gogh - Starry Night.jpg" },
		])
	})

	it("keeps object entries and wraps strings in a mixed list", () => {
		expect(
			normalizeGalleryFiles([
				"a.jpg",
				{ filename: "b.mp4", type: "video", preview: false },
				"",
			]),
		).toEqual([
			{ filename: "a.jpg" },
			{ filename: "b.mp4", type: "video", preview: false },
		])
	})

	it("returns an empty list for an empty payload", () => {
		expect(normalizeGalleryFiles([])).toEqual([])
	})
})
