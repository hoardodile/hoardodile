// @vitest-environment node

import { createResourceAPIFixture } from "@hoardodile/sdk-server"
import { describe, expect, it } from "vitest"
import plugin from "../main.ts"
import type { GallerySchema } from "../shared"

/**
 * Fixture probes are keyed by a path substring, so `{ ".jpg": … }`
 * answers for every jpeg and `{ "": … }` for every file. Sniffing falls
 * back to the extension table, which is what lets these fixtures stay
 * free of magic-byte payloads.
 */
const IMAGE_PROBE = {
	kind: "image",
	mime: "image/jpeg",
	width: 800,
	height: 1200,
	animated: false,
} as const

describe("gallery sourceMeta", () => {
	it("collects the first 3 media filenames in canonical order", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["10.jpg", "2.jpg", "01.jpg", "03.mp4", "readme.txt", "04.webp"],
			probes: {
				".mp4": {
					kind: "video",
					mime: "video/mp4",
					width: 640,
					height: 480,
				},
				"": IMAGE_PROBE,
			},
		})
		const result = (await plugin.sourceMeta?.(fixture.api)) as {
			width: number
			height: number
			previews: readonly { filename: string; type?: string }[]
		}
		expect(result.width).toBe(800)
		expect(result.height).toBe(1200)
		expect(result.previews.map((f) => f.filename)).toEqual([
			"10.jpg",
			"2.jpg",
			"01.jpg",
		])
	})

	it("returns fewer than 3 when fewer media files exist", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["a.jpg", "b.png", "notes.txt"],
			probes: {
				".jpg": { ...IMAGE_PROBE, width: 1, height: 1 },
				".png": { ...IMAGE_PROBE, mime: "image/png", width: 1, height: 1 },
			},
		})
		const result = (await plugin.sourceMeta?.(fixture.api)) as {
			previews: readonly { filename: string }[]
		}
		expect(result.previews.map((f) => f.filename)).toEqual(["a.jpg", "b.png"])
	})

	it("skips non-media files when collecting previews", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["01.jpg", "02.txt", "03.jpg", "04.zip", "05.png", "06.jpg"],
			probes: {
				".jpg": { ...IMAGE_PROBE, width: 1, height: 1 },
				".png": { ...IMAGE_PROBE, mime: "image/png", width: 1, height: 1 },
			},
		})
		const result = (await plugin.sourceMeta?.(fixture.api)) as {
			previews: readonly { filename: string }[]
		}
		expect(result.previews.map((f) => f.filename)).toEqual([
			"01.jpg",
			"03.jpg",
			"05.png",
		])
	})

	it("ignores nested entries when collecting previews", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["01.jpg", "sub/02.jpg", "03.png", "deep/album/04.jpg"],
			probes: { "": { ...IMAGE_PROBE, width: 1, height: 1 } },
		})
		const result = (await plugin.sourceMeta?.(fixture.api)) as {
			previews: readonly { filename: string }[]
		}
		expect(result.previews.map((f) => f.filename)).toEqual(["01.jpg", "03.png"])
	})

	it("forces preview rendering for formats browsers cannot decode natively", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["a.heic", "b.tiff", "c.svg", "d.jpg"],
			probes: { "": { ...IMAGE_PROBE, width: 1, height: 1 } },
		})
		const result = (await plugin.sourceMeta?.(fixture.api)) as {
			previews: readonly { filename: string; preview?: boolean }[]
		}
		expect(result.previews).toEqual([
			{
				filename: "a.heic",
				type: "image",
				width: 1,
				height: 1,
				preview: true,
			},
			{
				filename: "b.tiff",
				type: "image",
				width: 1,
				height: 1,
				preview: true,
			},
			{
				filename: "c.svg",
				type: "image",
				width: 1,
				height: 1,
				preview: false,
			},
		])
	})

	it("forces preview from the sniffed content, not the filename", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["a.jpg", "scan", "b.png"],
			types: {
				"a.jpg": {
					mime: "image/heic",
					ext: ".heic",
					kind: "image",
					source: "magic",
				},
				scan: {
					mime: "image/heic",
					ext: ".heic",
					kind: "image",
					source: "magic",
				},
			},
			probes: { "": { ...IMAGE_PROBE, width: 1, height: 1 } },
		})
		const result = (await plugin.sourceMeta?.(fixture.api)) as {
			previews: readonly { filename: string; preview?: boolean }[]
		}
		expect(result.previews.map((f) => [f.filename, f.preview])).toEqual([
			["a.jpg", true],
			["scan", true],
			["b.png", false],
		])
	})

	it("returns probe data for the first file regardless of type", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["00.mp4", "01.jpg", "02.jpg"],
			probes: {
				".mp4": {
					kind: "video",
					mime: "video/mp4",
					width: 1920,
					height: 1080,
					durationMs: 5_000,
				},
				"": { ...IMAGE_PROBE, width: 800, height: 600 },
			},
		})
		const result = (await plugin.sourceMeta?.(fixture.api)) as {
			width: number
			height: number
			durationMs: number
			previews: readonly { filename: string }[]
		}
		expect(result.width).toBe(1920)
		expect(result.height).toBe(1080)
		expect(result.durationMs).toBe(5_000)
		expect(result.previews.map((f) => f.filename)).toEqual([
			"00.mp4",
			"01.jpg",
			"02.jpg",
		])
	})

	it("returns undefined when the first file probe fails", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["a.jpg", "b.jpg"],
			probes: { "": { kind: "unknown", reason: "failed" } },
		})
		const result = await plugin.sourceMeta?.(fixture.api)
		expect(result).toBeUndefined()
	})

	it("returns undefined when no media files present", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["readme.txt", "notes.md"],
		})
		const result = await plugin.sourceMeta?.(fixture.api)
		expect(result).toBeUndefined()
	})

	it("carries the audio duration so the card badge has something to render", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["01.mp3", "02.mp3"],
			probes: {
				"": { kind: "audio", mime: "audio/mpeg", durationMs: 183_000 },
			},
		})
		const result = (await plugin.sourceMeta?.(fixture.api)) as {
			durationMs?: number
			previews: readonly { filename: string; type?: string }[]
		}
		expect(result.durationMs).toBe(183_000)
		expect(result.previews.map((f) => f.type)).toEqual(["audio", "audio"])
	})

	it("reads media out of a mislabelled file", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["scan.dat"],
			types: {
				"scan.dat": {
					mime: "image/jpeg",
					ext: ".jpg",
					kind: "image",
					source: "magic",
				},
			},
			probes: { "scan.dat": IMAGE_PROBE },
		})
		const result = (await plugin.sourceMeta?.(fixture.api)) as {
			width: number
			previews: readonly { filename: string }[]
		}
		expect(result.width).toBe(800)
		expect(result.previews.map((f) => f.filename)).toEqual(["scan.dat"])
	})
})

describe("gallery coverLocal", () => {
	it("prefers images and videos over audio", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["01.mp3", "02.jpg"],
			probes: { ".mp3": { kind: "audio", mime: "audio/mpeg", coverArt: {} } },
		})
		expect(await plugin.coverLocal?.(fixture.api)).toBe("02.jpg")
	})

	it("picks the first audio track carrying embedded artwork", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["01.mp3", "02.mp3"],
			probes: {
				"02.mp3": {
					kind: "audio",
					mime: "audio/mpeg",
					coverArt: { width: 600, height: 600 },
				},
				"": { kind: "audio", mime: "audio/mpeg" },
			},
		})
		expect(await plugin.coverLocal?.(fixture.api)).toBe("02.mp3")
	})

	it("still returns a track when none carry artwork, so the card knows it is audio", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["02.mp3", "01.mp3"],
			probes: { "": { kind: "audio", mime: "audio/mpeg", durationMs: 1000 } },
		})
		// The first file in canonical order wins the fallback.
		expect(await plugin.coverLocal?.(fixture.api)).toBe("02.mp3")
	})

	it("returns undefined without any media", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["readme.txt"],
		})
		expect(await plugin.coverLocal?.(fixture.api)).toBeUndefined()
	})

	it("never picks a nested file as the cover", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["nested/album/01.jpg", "cover.png"],
		})
		expect(await plugin.coverLocal?.(fixture.api)).toBe("cover.png")
	})

	it("returns undefined when only nested media exists", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["nested/album/01.jpg"],
		})
		expect(await plugin.coverLocal?.(fixture.api)).toBeUndefined()
	})
})
