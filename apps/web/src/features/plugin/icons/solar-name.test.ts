import { describe, expect, test } from "vitest"
import { isSolarGlyphName, normalizeSolarGlyphName } from "./solar-name"

describe("normalizeSolarGlyphName", () => {
	test("kebab names pass through", () => {
		expect(normalizeSolarGlyphName("video-frame")).toBe("video-frame")
		expect(normalizeSolarGlyphName("add-circle")).toBe("add-circle")
	})

	test("trims whitespace", () => {
		expect(normalizeSolarGlyphName("  heart  ")).toBe("heart")
	})

	test("PascalCase converts to kebab", () => {
		expect(normalizeSolarGlyphName("Heart")).toBe("heart")
		expect(normalizeSolarGlyphName("FileText")).toBe("file-text")
		expect(normalizeSolarGlyphName("AltArrowDown")).toBe("alt-arrow-down")
		expect(normalizeSolarGlyphName("AddCircle")).toBe("add-circle")
	})

	test("legacy whitelist names map to their Solar counterpart", () => {
		expect(normalizeSolarGlyphName("Files")).toBe("file")
		expect(normalizeSolarGlyphName("Image")).toBe("gallery")
		expect(normalizeSolarGlyphName("Film")).toBe("video-frame")
		expect(normalizeSolarGlyphName("Video")).toBe("video-frame")
		expect(normalizeSolarGlyphName("Info")).toBe("info-circle")
		expect(normalizeSolarGlyphName("Music")).toBe("music-notes")
		expect(normalizeSolarGlyphName("Search")).toBe("magnifier")
		expect(normalizeSolarGlyphName("Sparkle")).toBe("star")
		expect(normalizeSolarGlyphName("Star")).toBe("star")
		expect(normalizeSolarGlyphName("Gallery")).toBe("gallery")
		expect(normalizeSolarGlyphName("Download")).toBe("download")
		expect(normalizeSolarGlyphName("Eye")).toBe("eye")
		expect(normalizeSolarGlyphName("Filter")).toBe("filter")
		expect(normalizeSolarGlyphName("Folder")).toBe("folder")
		expect(normalizeSolarGlyphName("Pause")).toBe("pause")
		expect(normalizeSolarGlyphName("Play")).toBe("play")
		expect(normalizeSolarGlyphName("Tag")).toBe("tag")
	})

	test("schemes, separators and punctuation are rejected", () => {
		expect(normalizeSolarGlyphName("http://example.com")).toBeUndefined()
		expect(normalizeSolarGlyphName("data:image/png")).toBeUndefined()
		expect(normalizeSolarGlyphName("icon:Heart")).toBeUndefined()
		expect(normalizeSolarGlyphName("icons/heart.gif")).toBeUndefined()
		expect(normalizeSolarGlyphName("heart.svg")).toBeUndefined()
		expect(normalizeSolarGlyphName("")).toBeUndefined()
		expect(normalizeSolarGlyphName("   ")).toBeUndefined()
		expect(normalizeSolarGlyphName("heart!")).toBeUndefined()
	})

	test("membership guards the generated index", () => {
		expect(isSolarGlyphName("video-frame")).toBe(true)
		expect(isSolarGlyphName("VideoFrame")).toBe(true)
		expect(isSolarGlyphName("Image")).toBe(true)
		expect(isSolarGlyphName("not-a-real-glyph")).toBe(false)
		expect(isSolarGlyphName("Heart?")).toBe(false)
	})
})
