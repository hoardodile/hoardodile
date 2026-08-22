import { mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough } from "node:stream"
import { readImageMetadata } from "@hoardodile/host/probe"
import sharp from "sharp"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { generateUploadPreview } from "./preview.ts"

vi.mock("@hoardodile/host/probe", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@hoardodile/host/probe")>()
	return {
		...actual,
		readImageMetadata: vi.fn(),
	}
})

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
	execFile: vi.fn(),
}))

const FFMPEG = { ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe" }

async function makePng(): Promise<Buffer> {
	return sharp({
		create: {
			width: 120,
			height: 90,
			channels: 3,
			background: { r: 1, g: 2, b: 3 },
		},
	})
		.png()
		.toBuffer()
}

describe("generateUploadPreview", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "upload-preview-"))
	})

	afterEach(() => {
		vi.clearAllMocks()
		rmSync(root, { recursive: true, force: true })
	})

	test("static image renders an AVIF preview", async () => {
		const png = await makePng()
		const sourceMeta = await sharp(png).metadata()
		vi.mocked(readImageMetadata).mockResolvedValue({
			meta: sourceMeta,
			animated: false,
		})
		const src = join(root, "photo.png")
		writeFileSync(src, png)

		const result = await generateUploadPreview(
			src,
			join(root, "preview"),
			FFMPEG,
		)
		expect(result.contentType).toBe("image/avif")
		expect(result.path.endsWith(".avif")).toBe(true)
		const meta = await sharp(result.path).metadata()
		expect(meta.width).toBe(120)
		expect(meta.height).toBe(90)
	})

	test("animated source downgrades to WebP", async () => {
		const png = await makePng()
		const sourceMeta = await sharp(png).metadata()
		vi.mocked(readImageMetadata).mockResolvedValue({
			meta: { ...sourceMeta, pages: 2 },
			animated: true,
		})
		const src = join(root, "anim.webp")
		writeFileSync(src, png)

		const result = await generateUploadPreview(
			src,
			join(root, "preview"),
			FFMPEG,
		)
		expect(result.contentType).toBe("image/webp")
		expect(result.path.endsWith(".webp")).toBe(true)
	})

	test("unsupported content rejects", async () => {
		const src = join(root, "notes.txt")
		writeFileSync(src, "hello")
		await expect(
			generateUploadPreview(src, join(root, "preview"), FFMPEG),
		).rejects.toThrow(/unsupported/)
	})

	test("image content wins over a misleading extension (sniffed, not gated)", async () => {
		const png = await makePng()
		const sourceMeta = await sharp(png).metadata()
		vi.mocked(readImageMetadata).mockResolvedValue({
			meta: sourceMeta,
			animated: false,
		})
		const src = join(root, "photo.bin")
		writeFileSync(src, png)

		const result = await generateUploadPreview(
			src,
			join(root, "preview"),
			FFMPEG,
		)
		expect(result.contentType).toBe("image/avif")
		const meta = await sharp(result.path).metadata()
		expect(meta.width).toBe(120)
		expect(meta.height).toBe(90)
	})

	test("video renders an AVIF frame via ffmpeg", async () => {
		const { spawn } = await import("node:child_process")
		const jpeg = await sharp({
			create: {
				width: 64,
				height: 48,
				channels: 3,
				background: { r: 9, g: 8, b: 7 },
			},
		})
			.jpeg()
			.toBuffer()
		const fakeChild = {
			stdin: new PassThrough(),
			stdout: {
				on: vi.fn((_event: string, handler: (chunk: Buffer) => void) => {
					handler(jpeg)
				}),
			},
			stderr: { on: vi.fn() },
			on: vi.fn((event: string, handler: (code: number) => void) => {
				if (event === "close") handler(0)
			}),
		}
		vi.mocked(spawn).mockReturnValue(fakeChild as never)

		const src = join(root, "clip.mp4")
		writeFileSync(src, "fake-video")
		const result = await generateUploadPreview(
			src,
			join(root, "preview"),
			FFMPEG,
		)
		expect(result.contentType).toBe("image/avif")
		const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
		expect(args).toContain(src)
	})
})
