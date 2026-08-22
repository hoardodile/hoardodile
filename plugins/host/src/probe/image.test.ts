import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
	needsFullAnimationScan,
	PROBE_HEADER_BYTES,
	probeAnimatedImage,
	probeImageSource,
	readImageMetadata,
	THUMB_BUFFER_MAX_BYTES,
} from "./image.ts"

describe("probeAnimatedImage", () => {
	test("returns false for video extensions without invoking sharp", async () => {
		const dir = mkdtempSync(join(tmpdir(), "probe-anim-"))
		try {
			const path = join(dir, "clip.mp4")
			writeFileSync(path, "not-a-real-mp4")
			await expect(probeAnimatedImage(path)).resolves.toBe(false)
		} finally {
			rmSync(dir, { recursive: true, force: true })
		}
	})
})

describe("probeImageSource", () => {
	test("static PNG is not animated after a single-page read", async () => {
		const png = await sharp({
			create: {
				width: 32,
				height: 32,
				channels: 3,
				background: { r: 10, g: 20, b: 30 },
			},
		})
			.png()
			.toBuffer()
		const probe = await probeImageSource(png, ".png")
		expect(probe).toEqual({
			width: 32,
			height: 32,
			animated: false,
		})
	})

	test("stream input probes normally", async () => {
		const png = await sharp({
			create: {
				width: 16,
				height: 8,
				channels: 3,
				background: { r: 1, g: 2, b: 3 },
			},
		})
			.png()
			.toBuffer()
		const probe = await probeImageSource(Readable.from(png), ".png")
		expect(probe).toEqual({ width: 16, height: 8, animated: false })
	})

	test("reopenable stream input probes normally", async () => {
		const png = await sharp({
			create: {
				width: 16,
				height: 8,
				channels: 3,
				background: { r: 1, g: 2, b: 3 },
			},
		})
			.png()
			.toBuffer()
		const probe = await probeImageSource(
			{ openStream: async () => Readable.from(png) },
			".png",
		)
		expect(probe).toEqual({ width: 16, height: 8, animated: false })
	})

	test("valid stream input beyond the byte cap still probes (header-only read)", async () => {
		const png = await sharp({
			create: {
				width: 16,
				height: 8,
				channels: 3,
				background: { r: 1, g: 2, b: 3 },
			},
		})
			.png()
			.toBuffer()
		// The PNG header sits at the start; the probe must read only what
		// it needs instead of buffering the whole (oversized) entry.
		const oversized = Buffer.concat([
			png,
			Buffer.alloc(THUMB_BUFFER_MAX_BYTES + 1),
		])
		const probe = await probeImageSource(Readable.from(oversized), ".png")
		expect(probe).toEqual({ width: 16, height: 8, animated: false })
	})

	test("garbage stream input degrades to undefined", async () => {
		const probe = await probeImageSource(
			Readable.from(Buffer.alloc(THUMB_BUFFER_MAX_BYTES + 1, 0xab)),
			".png",
		)
		expect(probe).toBeUndefined()
	})
})

describe("needsFullAnimationScan", () => {
	test("gif always escalates to full scan", () => {
		expect(needsFullAnimationScan({ width: 1, height: 1 }, ".gif")).toBe(true)
	})

	test("static jpeg does not escalate", () => {
		expect(
			needsFullAnimationScan({ width: 4000, height: 3000, pages: 1 }, ".jpg"),
		).toBe(false)
	})
})

describe("readImageMetadata", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "probe-meta-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("reads static jpeg dimensions from buffer", async () => {
		const jpeg = await sharp({
			create: {
				width: 120,
				height: 80,
				channels: 3,
				background: { r: 1, g: 2, b: 3 },
			},
		})
			.jpeg()
			.toBuffer()
		const { meta, animated } = await readImageMetadata(jpeg, ".jpg")
		expect(animated).toBe(false)
		expect(meta.width).toBe(120)
		expect(meta.height).toBe(80)
	})
})

describe("readImageMetadata header-slice fast path", () => {
	async function makePng(): Promise<Buffer> {
		return sharp({
			create: {
				width: 16,
				height: 8,
				channels: 3,
				background: { r: 1, g: 2, b: 3 },
			},
		})
			.png()
			.toBuffer()
	}

	test("static image probes from the header slice without opening a stream", async () => {
		const png = await makePng()
		let streams = 0
		const { meta, animated } = await readImageMetadata(
			{
				openStream: async () => {
					streams++
					return Readable.from(png)
				},
				readRange: async (start, end) => png.subarray(start, end),
			},
			".png",
		)
		expect(meta.width).toBe(16)
		expect(meta.height).toBe(8)
		expect(animated).toBe(false)
		expect(streams).toBe(0)
	})

	test("an inconclusive slice falls back to the stream", async () => {
		const png = await makePng()
		const { meta, animated } = await readImageMetadata(
			{
				openStream: async () => Readable.from(png),
				readRange: async () => Buffer.from([0xde, 0xad]),
			},
			".png",
		)
		expect(meta.width).toBe(16)
		expect(animated).toBe(false)
	})

	test("gif probes never use the header slice (frame count needs the full scan)", async () => {
		const gif = await sharp({
			create: {
				width: 8,
				height: 8,
				channels: 3,
				background: { r: 1, g: 2, b: 3 },
			},
		})
			.gif()
			.toBuffer()
		let sliceCalls = 0
		const { meta } = await readImageMetadata(
			{
				openStream: async () => Readable.from(gif),
				readRange: async () => {
					sliceCalls++
					return gif.subarray(0, PROBE_HEADER_BYTES)
				},
			},
			".gif",
		)
		expect(meta.width).toBe(8)
		expect(sliceCalls).toBe(0)
	})

	test("static webp probes from the header slice too", async () => {
		const webp = await sharp({
			create: {
				width: 12,
				height: 10,
				channels: 3,
				background: { r: 1, g: 2, b: 3 },
			},
		})
			.webp()
			.toBuffer()
		let streams = 0
		const { meta, animated } = await readImageMetadata(
			{
				openStream: async () => {
					streams++
					return Readable.from(webp)
				},
				readRange: async (start, end) => webp.subarray(start, end),
			},
			".webp",
		)
		expect(meta.width).toBe(12)
		expect(animated).toBe(false)
		expect(streams).toBe(0)
	})
})
