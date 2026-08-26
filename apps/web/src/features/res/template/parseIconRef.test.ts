/**
 * @vitest-environment node
 */

import { describe, expect, test } from "vitest"
import { parseIconRef } from "./template-icons"

describe("parseIconRef", () => {
	test("plain name → normalized Solar glyph name", () => {
		expect(parseIconRef("Heart", "pid")).toEqual({
			kind: "icon",
			name: "heart",
		})
	})

	test("trims whitespace", () => {
		expect(parseIconRef("  Heart  ", "pid")).toEqual({
			kind: "icon",
			name: "heart",
		})
	})

	test("legacy whitelist names normalize to their Solar glyph", () => {
		expect(parseIconRef("Image", "pid")).toEqual({
			kind: "icon",
			name: "gallery",
		})
		expect(parseIconRef("FileText", "pid")).toEqual({
			kind: "icon",
			name: "file-text",
		})
	})

	test("the name: prefix is rejected outright", () => {
		expect(parseIconRef("icon:Heart", "pid")).toBeUndefined()
	})

	test("parses relative asset path", () => {
		expect(parseIconRef("icons/heart.gif", "pid")).toEqual({
			kind: "asset",
			url: "/api/plugins/pid/icons/heart.gif",
		})
	})

	test("strips leading ./ from asset path", () => {
		expect(parseIconRef("./icons/heart.gif", "pid")).toEqual({
			kind: "asset",
			url: "/api/plugins/pid/icons/heart.gif",
		})
	})

	test("returns undefined for empty asset path", () => {
		expect(parseIconRef("./", "pid")).toBeUndefined()
	})

	test("returns undefined for .. asset paths", () => {
		expect(parseIconRef("../x.svg", "pid")).toBeUndefined()
		expect(parseIconRef("icons/../x.svg", "pid")).toBeUndefined()
	})

	test("returns undefined for http scheme", () => {
		expect(parseIconRef("http://example.com/icon.png", "pid")).toBeUndefined()
	})

	test("returns undefined for https scheme", () => {
		expect(parseIconRef("https://example.com/icon.png", "pid")).toBeUndefined()
	})

	test("returns undefined for data scheme", () => {
		expect(parseIconRef("data:image/png;base64,abc", "pid")).toBeUndefined()
	})

	test("returns undefined for empty string", () => {
		expect(parseIconRef("", "pid")).toBeUndefined()
	})

	test("returns undefined for whitespace-only string", () => {
		expect(parseIconRef("   ", "pid")).toBeUndefined()
	})
})
