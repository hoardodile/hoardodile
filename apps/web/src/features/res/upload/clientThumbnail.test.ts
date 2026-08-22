/**
 * @vitest-environment node
 */

import { describe, expect, it } from "vitest"
import { extensionLabel, fileExt, isThumbnailable } from "./clientThumbnail"

describe("fileExt", () => {
	it("returns lowercased extension with the leading dot", () => {
		expect(fileExt("photo.JPG")).toBe(".jpg")
		expect(fileExt("clip.webm")).toBe(".webm")
	})

	it("returns empty string when the name has no dot", () => {
		expect(fileExt("README")).toBe("")
	})

	it("uses the last dot so dotfiles with extensions still split", () => {
		expect(fileExt("archive.tar.gz")).toBe(".gz")
	})
})

describe("extensionLabel", () => {
	it("returns the uppercase extension truncated to 4 chars", () => {
		expect(extensionLabel("video.webm")).toBe("WEBM")
		expect(extensionLabel("scan.jpeg")).toBe("JPEG")
	})

	it("falls back to FILE for missing or trailing-dot names", () => {
		expect(extensionLabel("README")).toBe("FILE")
		expect(extensionLabel("name.")).toBe("FILE")
	})
})

describe("isThumbnailable", () => {
	it("recognises image files by extension", () => {
		const file = new File([""], "p.png", { type: "" })
		expect(isThumbnailable(file)).toBe(true)
	})

	it("recognises video files by MIME type when extension is unknown", () => {
		const file = new File([""], "clip.bin", { type: "video/mp4" })
		expect(isThumbnailable(file)).toBe(true)
	})

	it("rejects unrelated file types", () => {
		const file = new File([""], "doc.pdf", { type: "application/pdf" })
		expect(isThumbnailable(file)).toBe(false)
	})
})
