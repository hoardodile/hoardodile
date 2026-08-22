// @vitest-environment node

import { createResourceAPIFixture } from "@hoardodile/sdk-server"
import { describe, expect, it } from "vitest"
import plugin from "../main.ts"
import type { GallerySchema } from "../shared"

describe("gallery detect", () => {
	it("detects flat media files by content", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["01.jpg", "02.png"],
		})
		expect(await plugin.detect(fixture.api)).toEqual({ ok: true })
	})

	it("detects a single media file", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["a.heic"],
		})
		expect(await plugin.detect(fixture.api)).toEqual({ ok: true })
	})

	it("detects the added mainstream formats (heic/tiff/svg/3gp/aac)", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["a.heic", "b.tiff", "c.svg", "d.3gp", "e.aac"],
		})
		expect(await plugin.detect(fixture.api)).toEqual({ ok: true })
	})

	it("fails without any flat media file", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["readme.txt", "notes.md"],
		})
		expect(await plugin.detect(fixture.api)).toEqual({
			ok: false,
			reasons: ["media-file"],
		})
	})

	it("ignores nested media: a folder-shaped resource is not a gallery", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["album/01.jpg", "album/02.jpg"],
		})
		expect(await plugin.detect(fixture.api)).toEqual({
			ok: false,
			reasons: ["media-file"],
		})
	})

	it("detects when at least one flat media file exists, ignoring nested ones", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["01.jpg", "album/02.jpg"],
		})
		expect(await plugin.detect(fixture.api)).toEqual({ ok: true })
	})
})

describe("gallery searchMeta", () => {
	it("reports nothing for a nested-only resource", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["album/01.jpg", "album/02.jpg"],
		})
		expect(await plugin.searchMeta?.(fixture.api)).toBeUndefined()
	})

	it("ignores nested media when collecting facets", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["01.jpg", "album/02.png", "03.webp"],
		})
		const result = await plugin.searchMeta?.(fixture.api)
		expect(result?.facets).toMatchObject({ image: true, animation: false })
	})
})
