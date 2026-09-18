import { mkdtempSync, rmSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { PassThrough, Readable } from "node:stream"
import sharp from "sharp"
import { afterEach, describe, expect, test, vi } from "vitest"
import { renderImageThumbOnce, renderVideoFrame } from "./pipeline.ts"

vi.mock("node:child_process", () => ({
	spawn: vi.fn(),
	execFile: vi.fn(),
}))

describe("renderImageThumbOnce stream input", () => {
	afterEach(() => {
		vi.resetModules()
		vi.clearAllMocks()
	})

	test("reopenable stream input renders (piped sharp input)", async () => {
		// Regression lock for the >32MB stream path: sharp's constructor
		// rejects `sharp(stream, opts)`, so stream inputs must go through
		// the piped-descriptor form in sharpFromReadable.
		const png = await sharp({
			create: {
				width: 64,
				height: 48,
				channels: 3,
				background: { r: 12, g: 34, b: 56 },
			},
		})
			.png()
			.toBuffer()

		const destDir = mkdtempSync(join(tmpdir(), "stream-thumb-"))
		try {
			const rendered = await renderImageThumbOnce({
				input: { openStream: async () => Readable.from(png) },
				ext: ".png",
				resolveDest: (fmt) => join(destDir, `cover.${fmt}`),
				variant: {
					format: "avif",
					fit: "inside",
					maxArea: 10_000,
					webpQuality: 82,
					avifQuality: 65,
					preserveTransparentRgb: false,
				},
			})
			expect(rendered.format).toBe("avif")
			const meta = await sharp(rendered.path).metadata()
			expect(meta.width).toBe(64)
			expect(meta.height).toBe(48)
		} finally {
			rmSync(destDir, { recursive: true, force: true })
		}
	})

	test("fit exact transcodes at source dimensions even under a tiny area cap", async () => {
		const png = await sharp({
			create: {
				width: 64,
				height: 48,
				channels: 3,
				background: { r: 12, g: 34, b: 56 },
			},
		})
			.png()
			.toBuffer()

		const destDir = mkdtempSync(join(tmpdir(), "exact-thumb-"))
		try {
			const rendered = await renderImageThumbOnce({
				input: png,
				ext: ".png",
				resolveDest: (fmt) => join(destDir, `exact.${fmt}`),
				// A cap this small would shrink the source under `inside`;
				// `exact` must ignore it entirely.
				variant: {
					format: "avif",
					fit: "exact",
					maxArea: 100,
					webpQuality: 82,
					avifQuality: 65,
					preserveTransparentRgb: true,
				},
			})
			expect(rendered.format).toBe("avif")
			expect(rendered.displayWidth).toBe(64)
			expect(rendered.displayHeight).toBe(48)
			const meta = await sharp(rendered.path).metadata()
			expect(meta.width).toBe(64)
			expect(meta.height).toBe(48)
		} finally {
			rmSync(destDir, { recursive: true, force: true })
		}
	})

	test("fit inside still downscales to the area cap", async () => {
		const png = await sharp({
			create: {
				width: 64,
				height: 48,
				channels: 3,
				background: { r: 12, g: 34, b: 56 },
			},
		})
			.png()
			.toBuffer()

		const destDir = mkdtempSync(join(tmpdir(), "inside-thumb-"))
		try {
			const rendered = await renderImageThumbOnce({
				input: png,
				ext: ".png",
				resolveDest: (fmt) => join(destDir, `inside.${fmt}`),
				variant: {
					format: "avif",
					fit: "inside",
					maxArea: 100,
					webpQuality: 82,
					avifQuality: 65,
					preserveTransparentRgb: false,
				},
			})
			const meta = await sharp(rendered.path).metadata()
			const area = (meta.width ?? 0) * (meta.height ?? 0)
			expect(area).toBeLessThan(100)
			expect(meta.width).toBeLessThan(64)
		} finally {
			rmSync(destDir, { recursive: true, force: true })
		}
	})

	/**
	 * A model atlas stores its edge bleed in fully transparent pixels, and
	 * the GPU samples those pixels across every mesh seam. libwebp is free
	 * to rewrite that RGB by default (`exact` off) to help compressibility,
	 * which turns the bleed ring into arbitrary colours and shows up as
	 * blocky seams — so the `exact` fit, which promises a pure format
	 * change, must ask for `exact: true`.
	 */
	test("fit exact keeps the RGB under transparent pixels in WebP", async () => {
		const width = 64
		const height = 64
		const rgba = Buffer.alloc(width * height * 4)
		/** The bleed the encoder must preserve: a varying green ramp. */
		const bleedGreen = (y: number) => 20 + y * 3
		for (let y = 0; y < height; y += 1) {
			for (let x = 0; x < width; x += 1) {
				const index = (y * width + x) * 4
				if (x < width / 2) {
					rgba[index] = 200
					rgba[index + 1] = 40
					rgba[index + 2] = 40
					rgba[index + 3] = 255
				} else {
					// Fully transparent, carrying the region's bleed colour.
					rgba[index] = 10 + x
					rgba[index + 1] = bleedGreen(y)
					rgba[index + 2] = 200 - x
				}
			}
		}
		const source = await sharp(rgba, {
			raw: { width, height, channels: 4 },
		})
			.png()
			.toBuffer()

		const destDir = mkdtempSync(join(tmpdir(), "rgba-thumb-"))
		try {
			const render = (fit: "exact" | "inside") =>
				renderImageThumbOnce({
					input: source,
					ext: ".png",
					resolveDest: (fmt) => join(destDir, `${fit}.${fmt}`),
					variant: {
						format: "webp",
						fit,
						maxArea: 10_000,
						webpQuality: 90,
						avifQuality: 65,
						preserveTransparentRgb: fit === "exact",
					},
				})

			// Mean error of the transparent half's green against the source.
			// The read goes through a buffer so no libvips handle outlives it
			// (a path read can still hold the file when the temp dir goes).
			const bleedError = async (path: string) => {
				const { data, info } = await sharp(await readFile(path))
					.ensureAlpha()
					.raw()
					.toBuffer({ resolveWithObject: true })
				let sum = 0
				let count = 0
				for (let y = 0; y < height; y += 1) {
					for (let x = Math.floor(width / 2); x < width; x += 1) {
						const index = (y * info.width + x) * info.channels
						sum += Math.abs((data[index + 1] ?? 0) - bleedGreen(y))
						count += 1
					}
				}
				return sum / count
			}

			expect(await bleedError((await render("exact")).path)).toBeLessThan(5)
			expect(await bleedError((await render("inside")).path)).toBeGreaterThan(5)
		} finally {
			rmSync(destDir, { recursive: true, force: true })
		}
	})
})

describe("renderVideoFrame", () => {
	afterEach(() => {
		vi.resetModules()
		vi.clearAllMocks()
	})

	test("ffmpeg receives pipe:0 for stream sources", async () => {
		const { spawn } = await import("node:child_process")
		const jpeg = await sharp({
			create: {
				width: 8,
				height: 8,
				channels: 3,
				background: { r: 1, g: 2, b: 3 },
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

		const destDir = mkdtempSync(join(tmpdir(), "pipe-frame-"))
		try {
			const destPath = join(destDir, "frame.avif")
			const stream = Readable.from(Buffer.from("fake-video"))
			await renderVideoFrame({
				source: stream,
				ext: ".mp4",
				destPath,
				ffmpeg: { ffmpeg: "/bin/ffmpeg", ffprobe: "/bin/ffprobe" },
				maxArea: 10_000,
				quality: 65,
			})
			const args = vi.mocked(spawn).mock.calls[0]?.[1] as string[]
			expect(args).toContain("pipe:0")
			expect(args).toContain("-f")
			expect(args).toContain("mp4")
			expect(args).not.toContain("-ss")
			expect(args).not.toContain("fake-video")
		} finally {
			rmSync(destDir, { recursive: true, force: true })
		}
	})
})
