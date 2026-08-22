import { createResourceAPIFixture } from "@hoardodile/sdk-types"
import { describe, expect, test } from "vitest"
import {
	countSourceMeta,
	imageHashesFor,
	imageHashesForFile,
	mapConcurrent,
	mediaFileList,
} from "./helpers.ts"

describe("mapConcurrent", () => {
	test("maps every item and preserves input order", async () => {
		const items = Array.from({ length: 20 }, (_, i) => i)
		const result = await mapConcurrent(items, 4, async (n) => {
			// Later items resolve faster — order must still follow the input.
			await new Promise((resolve) => setTimeout(resolve, 20 - n))
			return n * 10
		})
		expect(result).toEqual(items.map((n) => n * 10))
	})

	test("never exceeds the concurrency limit", async () => {
		let inFlight = 0
		let maxInFlight = 0
		const items = Array.from({ length: 30 }, (_, i) => i)
		await mapConcurrent(items, 5, async () => {
			inFlight++
			maxInFlight = Math.max(maxInFlight, inFlight)
			await new Promise((resolve) => setTimeout(resolve, 2))
			inFlight--
		})
		expect(maxInFlight).toBe(5)
	})

	test("runs fully in parallel when the limit covers all items", async () => {
		let inFlight = 0
		let maxInFlight = 0
		await mapConcurrent([1, 2, 3], 10, async () => {
			inFlight++
			maxInFlight = Math.max(maxInFlight, inFlight)
			await new Promise((resolve) => setTimeout(resolve, 2))
			inFlight--
		})
		expect(maxInFlight).toBe(3)
	})

	test("propagates the first rejection", async () => {
		await expect(
			mapConcurrent([1, 2, 3], 2, async (n) => {
				if (n === 2) throw new Error("boom")
				await new Promise((resolve) => setTimeout(resolve, 5))
				return n
			}),
		).rejects.toThrow("boom")
	})

	test("handles an empty input", async () => {
		await expect(mapConcurrent([], 4, async () => 1)).resolves.toEqual([])
	})
})

describe("imageHashesForFile", () => {
	test("maps the requested kinds to ImageHash entries", async () => {
		const fixture = createResourceAPIFixture({
			imageHashes: {
				"1.jpg": {
					hashes: [
						{ scope: "1.jpg", type: "sha256", value: "aa" },
						{ scope: "1.jpg", type: "dhash", value: "bb" },
						{ scope: "1.jpg", type: "phash", value: "cc" },
					],
				},
			},
		})
		await expect(
			imageHashesForFile(fixture.api, "1.jpg", ["sha256", "dhash", "phash"]),
		).resolves.toEqual([
			{ scope: "1.jpg", type: "sha256", value: "aa" },
			{ scope: "1.jpg", type: "dhash", value: "bb" },
			{ scope: "1.jpg", type: "phash", value: "cc" },
		])
	})

	test("only returns the requested kinds", async () => {
		const fixture = createResourceAPIFixture({
			imageHashes: {
				"1.jpg": {
					hashes: [
						{ scope: "1.jpg", type: "sha256", value: "aa" },
						{ scope: "1.jpg", type: "dhash", value: "bb" },
					],
				},
			},
		})
		await expect(
			imageHashesForFile(fixture.api, "1.jpg", ["dhash"]),
		).resolves.toEqual([{ scope: "1.jpg", type: "dhash", value: "bb" }])
	})

	test("resolves to [] for undecodable files", async () => {
		const fixture = createResourceAPIFixture()
		await expect(
			imageHashesForFile(fixture.api, "broken.png"),
		).resolves.toEqual([])
	})
})

describe("imageHashesFor", () => {
	test("hashes every image file and skips non-images", async () => {
		const fixture = createResourceAPIFixture({
			files: ["1.jpg", "2.png", "readme.txt"],
			imageHashes: {
				"1.jpg": {
					hashes: [
						{ scope: "1.jpg", type: "sha256", value: "aa" },
						{ scope: "1.jpg", type: "dhash", value: "bb" },
					],
				},
				"2.png": {
					hashes: [
						{ scope: "2.png", type: "sha256", value: "cc" },
						{ scope: "2.png", type: "dhash", value: "dd" },
					],
				},
			},
		})
		await expect(imageHashesFor(fixture.api)).resolves.toEqual({
			hashes: [
				{ scope: "1.jpg", type: "sha256", value: "aa" },
				{ scope: "1.jpg", type: "dhash", value: "bb" },
				{ scope: "2.png", type: "sha256", value: "cc" },
				{ scope: "2.png", type: "dhash", value: "dd" },
			],
		})
	})

	test("defaults to sha256 + dhash and tolerates partial results", async () => {
		const fixture = createResourceAPIFixture({
			files: ["1.jpg"],
			imageHashes: {
				"1.jpg": {
					hashes: [{ scope: "1.jpg", type: "dhash", value: "bb" }],
				},
			},
		})
		await expect(imageHashesFor(fixture.api)).resolves.toEqual({
			hashes: [{ scope: "1.jpg", type: "dhash", value: "bb" }],
		})
	})

	test("returns an empty list for image-less resources", async () => {
		const fixture = createResourceAPIFixture({ files: ["notes.txt"] })
		await expect(imageHashesFor(fixture.api)).resolves.toEqual({ hashes: [] })
	})
})

describe("mediaFileList", () => {
	test("lists every decodable media file in canonical order", async () => {
		const fixture = createResourceAPIFixture({
			files: ["10.jpg", "2.jpg", "01.mp4", "track.mp3", "readme.txt"],
			probes: {
				".mp4": {
					kind: "video",
					mime: "video/mp4",
					width: 640,
					height: 480,
					durationMs: 1000,
				},
				".mp3": { kind: "audio", mime: "audio/mpeg", durationMs: 3000 },
				"": {
					kind: "image",
					mime: "image/jpeg",
					width: 800,
					height: 1200,
					animated: false,
				},
			},
		})
		const result = await mediaFileList(fixture.api)
		expect(result.map((entry) => entry.filename)).toEqual([
			"10.jpg",
			"2.jpg",
			"01.mp4",
			"track.mp3",
		])
		expect(result[0]).toMatchObject({ type: "image", width: 800 })
		expect(result[1]).toMatchObject({ type: "image", width: 800 })
		expect(result[2]).toMatchObject({
			type: "video",
			width: 640,
			durationMs: 1000,
			sniffed: { mime: "video/mp4" },
		})
		expect(result[3]).toMatchObject({ type: "audio", durationMs: 3000 })
	})

	test("accepts a pre-filtered name list without re-listing", async () => {
		const fixture = createResourceAPIFixture({
			files: ["a.jpg", "sub/b.jpg"],
			probes: {
				"": {
					kind: "image",
					mime: "image/jpeg",
					width: 10,
					height: 10,
					animated: false,
				},
			},
		})
		const result = await mediaFileList(fixture.api, {
			names: ["a.jpg"],
		})
		expect(result.map((entry) => entry.filename)).toEqual(["a.jpg"])
	})

	test("drops files that are not decodable media", async () => {
		const fixture = createResourceAPIFixture({
			files: ["a.jpg", "notes.txt"],
			probes: {
				"": {
					kind: "other",
					mime: "text/plain",
				},
			},
			types: {
				"a.jpg": {
					mime: "image/jpeg",
					ext: ".jpg",
					kind: "image",
					source: "magic",
				},
			},
		})
		await expect(mediaFileList(fixture.api)).resolves.toEqual([])
	})
})

describe("countSourceMeta", () => {
	test("reports the file count", async () => {
		const fixture = createResourceAPIFixture({ files: ["a", "b", "c"] })
		await expect(countSourceMeta(fixture.api)).resolves.toEqual({
			fileCount: 3,
		})
	})

	test("resolves to undefined for empty resources", async () => {
		const fixture = createResourceAPIFixture()
		await expect(countSourceMeta(fixture.api)).resolves.toBeUndefined()
	})
})
