/**
 * @vitest-environment node
 */

import { describe, expect, test } from "vitest"
import { normalizeSolarGlyphName, parseIconRef } from "./index.ts"

const buildAssetUrl = (pluginId: string, path: string) =>
	`/api/plugins/${pluginId}/${path}`

describe("normalizeSolarGlyphName", () => {
	test("passes kebab through", () => {
		expect(normalizeSolarGlyphName("video-frame")).toBe("video-frame")
	})

	test("converts PascalCase to kebab", () => {
		expect(normalizeSolarGlyphName("Heart")).toBe("heart")
		expect(normalizeSolarGlyphName("VideoFrame")).toBe("video-frame")
	})

	test("maps legacy whitelist aliases", () => {
		expect(normalizeSolarGlyphName("Image")).toBe("gallery")
		expect(normalizeSolarGlyphName("FileText")).toBe("file-text")
		expect(normalizeSolarGlyphName("Film")).toBe("video-frame")
	})

	test("returns undefined for empty, whitespace and prefixed input", () => {
		expect(normalizeSolarGlyphName("")).toBeUndefined()
		expect(normalizeSolarGlyphName("   ")).toBeUndefined()
		expect(normalizeSolarGlyphName("icon:Heart")).toBeUndefined()
	})
})

describe("parseIconRef", () => {
	test("plain name → normalized Solar glyph name", () => {
		expect(parseIconRef("Heart", "pid", buildAssetUrl)).toEqual({
			kind: "icon",
			name: "heart",
		})
	})

	test("trims whitespace", () => {
		expect(parseIconRef("  Heart  ", "pid", buildAssetUrl)).toEqual({
			kind: "icon",
			name: "heart",
		})
	})

	test("legacy whitelist names normalize to their Solar glyph", () => {
		expect(parseIconRef("Image", "pid", buildAssetUrl)).toEqual({
			kind: "icon",
			name: "gallery",
		})
		expect(parseIconRef("FileText", "pid", buildAssetUrl)).toEqual({
			kind: "icon",
			name: "file-text",
		})
	})

	test("the name: prefix is rejected outright", () => {
		expect(parseIconRef("icon:Heart", "pid", buildAssetUrl)).toBeUndefined()
	})

	test("parses a relative asset path through the URL builder", () => {
		expect(parseIconRef("icons/heart.gif", "pid", buildAssetUrl)).toEqual({
			kind: "asset",
			url: "/api/plugins/pid/icons/heart.gif",
		})
	})

	test("strips leading ./ from asset path", () => {
		expect(parseIconRef("./icons/heart.gif", "pid", buildAssetUrl)).toEqual({
			kind: "asset",
			url: "/api/plugins/pid/icons/heart.gif",
		})
	})

	test("returns undefined for empty and dot asset paths", () => {
		expect(parseIconRef("./", "pid", buildAssetUrl)).toBeUndefined()
		expect(parseIconRef("", "pid", buildAssetUrl)).toBeUndefined()
		expect(parseIconRef("   ", "pid", buildAssetUrl)).toBeUndefined()
	})

	test("returns undefined for .. asset paths", () => {
		expect(parseIconRef("../x.svg", "pid", buildAssetUrl)).toBeUndefined()
		expect(parseIconRef("icons/../x.svg", "pid", buildAssetUrl)).toBeUndefined()
	})

	test("returns undefined for http/https/data schemes", () => {
		expect(
			parseIconRef("http://example.com/icon.png", "pid", buildAssetUrl),
		).toBeUndefined()
		expect(
			parseIconRef("https://example.com/icon.png", "pid", buildAssetUrl),
		).toBeUndefined()
		expect(
			parseIconRef("data:image/png;base64,abc", "pid", buildAssetUrl),
		).toBeUndefined()
	})
})
