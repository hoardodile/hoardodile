import { createResourceAPIFixture } from "@hoardodile/sdk-types"
import { describe, expect, test } from "vitest"
import { files, hasExt, hasKind, hasMime } from "./detectors.ts"

/**
 * The content-aware detectors are what make a plugin robust against
 * mislabelled archives, so every case here pits the filename against
 * the sniffed type.
 */

describe("hasKind", () => {
	test("matches on content even when the extension lies", async () => {
		const { api } = createResourceAPIFixture({
			files: ["scan.dat"],
			types: {
				"scan.dat": {
					mime: "image/jpeg",
					ext: ".jpg",
					kind: "image",
					source: "magic",
				},
			},
		})
		await expect(hasKind("image")(api)).resolves.toEqual({ ok: true })
		// The extension detector, by contrast, sees nothing.
		await expect(hasExt(new Set([".jpg"]))(api)).resolves.toEqual({
			ok: false,
			reasons: ["required-extension"],
		})
	})

	test("misses when no file carries the kind", async () => {
		const { api } = createResourceAPIFixture({ files: ["notes.txt"] })
		await expect(hasKind("video")(api)).resolves.toEqual({
			ok: false,
			reasons: ["required-kind:video"],
		})
	})

	test("scans past the first batch of files", async () => {
		const names = Array.from({ length: 30 }, (_, i) => `${i}.txt`)
		const { api } = createResourceAPIFixture({
			files: [...names, "late.png"],
		})
		await expect(hasKind("image")(api)).resolves.toEqual({ ok: true })
	})
})

describe("hasMime", () => {
	test("matches formats a media kind cannot express", async () => {
		const { api } = createResourceAPIFixture({
			files: ["book.bin"],
			types: {
				"book.bin": {
					mime: "application/epub+zip",
					ext: ".epub",
					kind: "other",
					source: "magic",
				},
			},
		})
		await expect(hasMime(/^application\/epub/)(api)).resolves.toEqual({
			ok: true,
		})
		await expect(hasMime(/^application\/pdf/)(api)).resolves.toEqual({
			ok: false,
			reasons: ["required-mime"],
		})
	})

	test("a string matches by exact equality", async () => {
		const { api } = createResourceAPIFixture({
			files: ["book.bin"],
			types: {
				"book.bin": {
					mime: "application/epub+zip",
					ext: ".epub",
					kind: "other",
					source: "magic",
				},
			},
		})
		await expect(hasMime("application/epub+zip")(api)).resolves.toEqual({
			ok: true,
		})
		await expect(hasMime("application/pdf")(api)).resolves.toEqual({
			ok: false,
			reasons: ["required-mime"],
		})
	})
})

describe("files.firstOfKind", () => {
	test("returns the first file whose content matches", async () => {
		const { api } = createResourceAPIFixture({
			files: ["readme.txt", "cover.bin", "page.png"],
			types: {
				"cover.bin": {
					mime: "image/webp",
					ext: ".webp",
					kind: "image",
					source: "magic",
				},
			},
		})
		await expect(files.firstOfKind(api, "image")).resolves.toBe("cover.bin")
	})

	test("resolves to undefined when nothing matches", async () => {
		const { api } = createResourceAPIFixture({ files: ["readme.txt"] })
		await expect(
			files.firstOfKind(api, "image", "video"),
		).resolves.toBeUndefined()
	})
})
