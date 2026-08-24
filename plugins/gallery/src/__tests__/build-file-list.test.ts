// @vitest-environment node

import type { ProbeResult, ResourceAPI } from "@hoardodile/sdk-server"
import { createResourceAPIFixture } from "@hoardodile/sdk-server"
import { describe, expect, it } from "vitest"
import plugin from "../main.ts"
import type { GallerySchema } from "../shared"

function createApiStub(
	files: readonly string[],
	overrides: Partial<ResourceAPI<GallerySchema>> = {},
): ResourceAPI<GallerySchema> {
	return {
		logInfo() {},
		logWarn() {},
		logError() {},
		context: { detect: undefined },
		listFileNames: async () => files,
		readFile: async () => new Uint8Array(),
		statFile: async () => ({ sizeBytes: 100 }),
		statFiles: async (paths) => paths.map(() => ({ sizeBytes: 100 })),
		sniff: async (path) =>
			path.endsWith(".mp4")
				? { mime: "video/mp4", ext: ".mp4", kind: "video", source: "magic" }
				: { mime: "image/jpeg", ext: ".jpg", kind: "image", source: "magic" },
		probe: async () => ({
			kind: "image",
			mime: "image/jpeg",
			width: 800,
			height: 1200,
			animated: false,
		}),
		hashBytes: async () => "ab",
		computeImageHashes: async () => undefined,
		listContainer: async () => ({ entries: [] }),
		extractArchive: async () => ({ entries: [] }),
		download: async () => {
			throw new Error("stub: download not configured")
		},
		statAsset: async () => undefined,
		readAsset: async () => new Uint8Array(),
		deleteAsset: async () => ({ existed: false }),
		...overrides,
	}
}

describe("gallery listFiles", () => {
	it("preserves the canonical container order, skipping unknown types", async () => {
		// The host's `listFileNames` already returns canonical display
		// order (the `.order` upload order, natural name sort otherwise).
		// The gallery must not re-sort: a non-natural input order (like
		// the `.order` of a chapter-style resource) has to flow through
		// untouched.
		const media = ["10.jpg", "2.jpg", "01.mp4", "02.mp3", "03.webp"]
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: [...media, "readme.txt"],
			probes: {
				".mp4": {
					kind: "video",
					mime: "video/mp4",
					width: 640,
					height: 480,
					durationMs: 1000,
				},
				".mp3": { kind: "audio", mime: "audio/mpeg" },
				"": {
					kind: "image",
					mime: "image/jpeg",
					width: 800,
					height: 1200,
					animated: false,
				},
			},
			stats: { sizeBytes: 100 },
		})
		const result = await plugin.listFiles?.(fixture.api)
		expect(result?.map((f) => f.filename)).toEqual(media)

		const byName = new Map(result?.map((f) => [f.filename, f]))
		expect(byName.get("01.mp4")).toMatchObject({
			type: "video",
			width: 640,
			durationMs: 1000,
		})
		expect(byName.get("02.mp3")).toEqual({ filename: "02.mp3", type: "audio" })
		expect(byName.get("2.jpg")).toMatchObject({ type: "image", width: 800 })
		expect(byName.has("readme.txt")).toBe(false)
	})

	it("keeps a `.order`-style sequence even when names sort differently", async () => {
		// Mirrors the reported bug: a sequence whose upload order differs
		// from the natural name order must display in upload order, not
		// re-sorted (e.g. `02：02.webp` interleaving between `002` pages).
		const sequence = [
			"002_1_2.jpg",
			"003_1_3.jpg",
			"02：02.webp",
			"03：03.webp",
			"011_1_11.jpg",
		]
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: sequence,
			probes: {
				"": {
					kind: "image",
					mime: "image/jpeg",
					width: 800,
					height: 1200,
					animated: false,
				},
			},
		})
		const result = await plugin.listFiles?.(fixture.api)
		expect(result?.map((f) => f.filename)).toEqual(sequence)
	})

	it("types an entry by what the probe found, not by what the sniffer guessed", async () => {
		// An `.mkv` holding audio only: the container sniffs as video and
		// ffprobe corrects it.
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["set.mkv"],
			types: {
				"set.mkv": {
					mime: "video/x-matroska",
					ext: ".mkv",
					kind: "video",
					source: "magic",
				},
			},
			probes: {
				"set.mkv": { kind: "audio", mime: "video/x-matroska", durationMs: 42 },
			},
		})
		const result = await plugin.listFiles?.(fixture.api)
		expect(result).toEqual([
			{ filename: "set.mkv", type: "audio", durationMs: 42 },
		])
	})

	it("ignores nested entries: only top-level files join the gallery", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["01.jpg", "sub/02.jpg", "03.png", "deep/album/04.jpg"],
			probes: {
				"": {
					kind: "image",
					mime: "image/jpeg",
					width: 800,
					height: 600,
					animated: false,
				},
			},
		})
		const result = await plugin.listFiles?.(fixture.api)
		expect(result?.map((f) => f.filename)).toEqual(["01.jpg", "03.png"])
	})

	it("lists the added mainstream formats as media", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["a.heic", "b.tiff", "c.svg", "d.3gp", "e.aac", "notes.txt"],
			probes: {
				".heic": {
					kind: "image",
					mime: "image/heic",
					width: 3024,
					height: 4032,
					animated: false,
				},
				".tiff": {
					kind: "image",
					mime: "image/tiff",
					width: 1200,
					height: 800,
					animated: false,
				},
				".svg": {
					kind: "image",
					mime: "image/svg+xml",
					width: 200,
					height: 100,
					animated: false,
				},
				".3gp": {
					kind: "video",
					mime: "video/3gpp",
					width: 320,
					height: 240,
					durationMs: 9000,
				},
				".aac": { kind: "audio", mime: "audio/aac", durationMs: 3000 },
			},
		})
		const result = await plugin.listFiles?.(fixture.api)
		expect(result?.map((f) => f.filename)).toEqual([
			"a.heic",
			"b.tiff",
			"c.svg",
			"d.3gp",
			"e.aac",
		])
	})

	it("forces preview rendering for formats browsers cannot decode natively", async () => {
		const fixture = createResourceAPIFixture<GallerySchema>({
			files: ["a.heic", "b.tiff", "c.svg", "d.jpg"],
			probes: {
				"": {
					kind: "image",
					mime: "image/jpeg",
					width: 100,
					height: 100,
					animated: false,
				},
			},
		})
		const result = await plugin.listFiles?.(fixture.api)
		const byName = new Map(result?.map((f) => [f.filename, f]))
		expect(byName.get("a.heic")?.preview).toBe(true)
		expect(byName.get("b.tiff")?.preview).toBe(true)
		expect(byName.get("c.svg")?.preview).toBe(false)
		expect(byName.get("d.jpg")?.preview).toBe(false)
	})

	it("forces preview from the sniffed content, not the filename", async () => {
		// A `.jpg` holding HEIC bytes and an extension-less HEIC export:
		// the transcode decision follows the magic bytes, so both still
		// render through the pipeline instead of a broken `<img>`.
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
			probes: {
				"": {
					kind: "image",
					mime: "image/jpeg",
					width: 100,
					height: 100,
					animated: false,
				},
			},
		})
		const result = await plugin.listFiles?.(fixture.api)
		const byName = new Map(result?.map((f) => [f.filename, f]))
		expect(byName.get("a.jpg")?.preview).toBe(true)
		expect(byName.get("scan")?.preview).toBe(true)
		expect(byName.get("b.png")?.preview).toBe(false)
	})

	it("probes images and timed media concurrently within their own bounds", async () => {
		const images = Array.from(
			{ length: 20 },
			(_, i) => `${String(i).padStart(3, "0")}.jpg`,
		)
		const videos = Array.from(
			{ length: 10 },
			(_, i) => `${String(i).padStart(3, "0")}.mp4`,
		)
		let imageInFlight = 0
		let maxImageInFlight = 0
		let videoInFlight = 0
		let maxVideoInFlight = 0
		const api = createApiStub([...images, ...videos], {
			probe: async (path): Promise<ProbeResult> => {
				const video = path.endsWith(".mp4")
				if (video) {
					videoInFlight++
					maxVideoInFlight = Math.max(maxVideoInFlight, videoInFlight)
				} else {
					imageInFlight++
					maxImageInFlight = Math.max(maxImageInFlight, imageInFlight)
				}
				await new Promise((resolve) => setTimeout(resolve, 5))
				if (video) {
					videoInFlight--
					return { kind: "video", mime: "video/mp4", width: 640, height: 480 }
				}
				imageInFlight--
				return {
					kind: "image",
					mime: "image/jpeg",
					width: 800,
					height: 1200,
					animated: false,
				}
			},
		})
		const result = await plugin.listFiles?.(api)
		expect(result).toHaveLength(30)
		expect(maxImageInFlight).toBeGreaterThan(1)
		expect(maxImageInFlight).toBeLessThanOrEqual(8)
		expect(maxVideoInFlight).toBeGreaterThan(1)
		expect(maxVideoInFlight).toBeLessThanOrEqual(4)
	})
})
