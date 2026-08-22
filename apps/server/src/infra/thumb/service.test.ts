import { spawn } from "node:child_process"
import { mkdtempSync, rmSync } from "node:fs"
import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { renderVideoFrame, resolveFfmpegPaths } from "@hoardodile/host/render"
import { populatedCover } from "@hoardodile/schemas"
import sharp from "sharp"
import {
	createResourceService,
	type ResService,
} from "src/domain/res/service.ts"
import {
	createTestHooks,
	TEST_BUILTIN_ID,
} from "src/domain/res/test-registry.ts"
import { seedResourceArtifact } from "src/domain/res/test-seed.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import {
	createStoragePaths,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { createThumbService, RESOURCE_LOCAL_COVER_VARIANT } from "./service.ts"

// Spy on renderVideoFrame to pin which source the video cover pipeline
// renders from (entry stream vs materialized path); all else stays real.
vi.mock("@hoardodile/host/render", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("@hoardodile/host/render")>()
	return { ...actual, renderVideoFrame: vi.fn(actual.renderVideoFrame) }
})

async function prepareImageResource(
	resources: ResService,
	dbh: DbHandles,
	paths: StoragePaths,
	name: string,
	png: Buffer,
): Promise<Awaited<ReturnType<ResService["create"]>>> {
	const r = await resources.create({ name })
	await seedResourceArtifact({ db: dbh, paths }, r.id, [
		{ name: "a.png", bytes: png },
	])
	await resources.setContentPluginId(r.id, TEST_BUILTIN_ID)
	// setContentPluginId enqueues async meta rebuilds that materialize zip
	// entries; drain them before thumb synthesis so test teardown cannot race.
	await resources.rebuildAllMeta(r.id)
	return r
}

async function pngBuffer(rgb: {
	r: number
	g: number
	b: number
}): Promise<Buffer> {
	return sharp({
		create: {
			width: 40,
			height: 40,
			channels: 3,
			background: rgb,
		},
	})
		.png()
		.toBuffer()
}

describe("thumb service", () => {
	let root: string
	let dbh: DbHandles
	let paths: StoragePaths
	let resources: ResService

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-local-thumbs-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		paths = createStoragePaths({ root })
		resources = createResourceService({
			db: dbh.db,
			paths,
			pluginHooks: createTestHooks(),
			readOnly: { current: false },
		})
	})
	afterEach(async () => {
		dbh.close()
		sharp.cache(false)
		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				rmSync(root, { recursive: true, force: true })
				return
			} catch (err) {
				if (attempt === 4) throw err
				await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
			}
		}
	})

	test("getCover synthesises an avif for an image resource", async () => {
		const png = await pngBuffer({ r: 0, g: 128, b: 255 })
		const r = await prepareImageResource(resources, dbh, paths, "img", png)

		const thumbs = createThumbService({ paths, resources })
		const result = await thumbs.getCover(r.id)
		expect(result.kind).toBe("ready")
		if (result.kind === "ready") {
			const info = await stat(result.path)
			expect(info.size).toBeGreaterThan(0)
			expect(result.path).toBe(
				paths.local.localCover("resource", r.id, RESOURCE_LOCAL_COVER_VARIANT),
			)
		}
	})

	test("getCharacterThumb renders an avatar through the media channel", async () => {
		const png = await pngBuffer({ r: 10, g: 20, b: 30 })
		const charDir = paths.atVersion(1).character("char-thumb")
		await mkdir(charDir, { recursive: true })
		await writeFile(join(charDir, "avatar.png"), png)

		const thumbs = createThumbService({ paths, resources })
		const result = await thumbs.getCharacterThumb("char-thumb", "avatar", 1)
		expect(result.kind).toBe("ready")
		if (result.kind === "ready") {
			const meta = await sharp(result.path).metadata()
			expect(meta.width).toBe(40)
			expect(meta.height).toBe(40)
			expect(result.format).toBe("avif")
		}
	})

	test("N concurrent getCover calls collapse to one synth job", async () => {
		const png = await pngBuffer({ r: 255, g: 255, b: 0 })
		const r = await prepareImageResource(resources, dbh, paths, "img", png)

		let calls = 0
		const originalResolve = resources.resolveLocalCoverSource.bind(resources)
		const spiedResources: ResService = {
			...resources,
			resolveLocalCoverSource: async (id: string) => {
				calls += 1
				return originalResolve(id)
			},
		}
		const thumbs = createThumbService({ paths, resources: spiedResources })
		const results = await Promise.all([
			thumbs.getCover(r.id),
			thumbs.getCover(r.id),
			thumbs.getCover(r.id),
			thumbs.getCover(r.id),
		])
		for (const res of results) expect(res.kind).toBe("ready")
		expect(calls).toBe(1)
	})

	test("returns { unavailable, placeholder } for an empty resource folder", async () => {
		const r = await resources.create({ name: "empty" })
		const thumbs = createThumbService({ paths, resources })
		const result = await thumbs.getCover(r.id)
		expect(result).toEqual({ kind: "unavailable", reason: "placeholder" })
	})

	/**
	 * Encode a one-second tone as FLAC, optionally with a still image
	 * attached as embedded artwork. Both codecs are ffmpeg built-ins, so
	 * this works on any build; returns false when ffmpeg is unavailable
	 * and the caller skips.
	 */
	async function generateFlac(
		destPath: string,
		withArtwork: boolean,
	): Promise<boolean> {
		const ffmpeg = resolveFfmpegPaths()
		const args = [
			"-hide_banner",
			"-loglevel",
			"error",
			"-f",
			"lavfi",
			"-i",
			"sine=frequency=440:duration=1",
		]
		if (withArtwork) {
			args.push("-f", "lavfi", "-i", "color=c=blue:s=64x64:d=0.04")
			args.push("-map", "0:a", "-map", "1:v", "-frames:v", "1")
			args.push("-c:v", "mjpeg", "-disposition:v", "attached_pic")
		}
		args.push("-c:a", "flac", "-y", destPath)
		return new Promise<boolean>((resolve) => {
			const child = spawn(ffmpeg.ffmpeg, args, { stdio: "ignore" })
			child.on("error", () => resolve(false))
			child.on("close", (code) => resolve(code === 0))
		})
	}

	async function seedAudioResource(
		name: string,
		withArtwork: boolean,
	): Promise<{ id: string; flacPath: string } | undefined> {
		const flacPath = join(
			tmpdir(),
			`thumb-flac-${Date.now()}-${Math.random().toString(36).slice(2)}.flac`,
		)
		if (!(await generateFlac(flacPath, withArtwork))) return undefined
		const r = await resources.create({ name })
		await seedResourceArtifact({ db: dbh, paths }, r.id, [
			{ name: "track.flac", bytes: await readFile(flacPath) },
		])
		await resources.setContentPluginId(r.id, TEST_BUILTIN_ID)
		await resources.rebuildAllMeta(r.id)
		return { id: r.id, flacPath }
	}

	test("returns { unavailable, placeholder } for audio without embedded artwork", async () => {
		const seeded = await seedAudioResource("audio-bare", false)
		if (seeded === undefined) return
		try {
			// The resource is still recognised as audio — the card renders
			// its own player — it simply has no artwork to show.
			const detail = await resources.detail(seeded.id)
			expect(detail.coverMeta).toMatchObject({
				kind: "audio",
				source: "track.flac",
			})
			expect(populatedCover(detail.coverMeta)?.width).toBeUndefined()

			const thumbs = createThumbService({
				paths,
				resources,
				ffmpeg: resolveFfmpegPaths(),
			})
			const result = await thumbs.getCover(seeded.id)
			expect(result).toEqual({ kind: "unavailable", reason: "placeholder" })
		} finally {
			rmSync(seeded.flacPath, { force: true })
		}
	}, 30_000)

	test("getCover extracts embedded artwork as the audio cover", async () => {
		const seeded = await seedAudioResource("audio-art", true)
		if (seeded === undefined) return
		try {
			// Artwork dimensions land in coverMeta so the card can pre-size
			// the tile, while the kind stays audio.
			const detail = await resources.detail(seeded.id)
			expect(detail.coverMeta).toMatchObject({
				kind: "audio",
				source: "track.flac",
				width: 64,
				height: 64,
			})

			const thumbs = createThumbService({
				paths,
				resources,
				ffmpeg: resolveFfmpegPaths(),
			})
			const result = await thumbs.getCover(seeded.id)
			expect(result.kind).toBe("ready")
			if (result.kind === "ready") {
				const info = await stat(result.path)
				expect(info.size).toBeGreaterThan(0)
			}
		} finally {
			rmSync(seeded.flacPath, { force: true })
		}
	}, 30_000)

	test("getCover synthesises an avif for a zip-backed mp4 resource", async () => {
		const ffmpeg = resolveFfmpegPaths()
		const mp4Path = join(tmpdir(), `thumb-mp4-${Date.now()}.mp4`)
		const generated = await new Promise<boolean>((resolve) => {
			const child = spawn(
				ffmpeg.ffmpeg,
				[
					"-hide_banner",
					"-loglevel",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=c=red:s=64x64:d=0.2",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					"-y",
					mp4Path,
				],
				{ stdio: "ignore" },
			)
			child.on("error", () => resolve(false))
			child.on("close", (code) => resolve(code === 0))
		})
		if (!generated) return

		try {
			const mp4 = await readFile(mp4Path)
			const r = await resources.create({ name: "video" })
			await seedResourceArtifact({ db: dbh, paths }, r.id, [
				{ name: "clip.mp4", bytes: mp4 },
			])
			await resources.setContentPluginId(r.id, TEST_BUILTIN_ID)
			await resources.rebuildAllMeta(r.id)

			const thumbs = createThumbService({ paths, resources, ffmpeg })
			const result = await thumbs.getCover(r.id)
			expect(result.kind).toBe("ready")
			if (result.kind === "ready") {
				const info = await stat(result.path)
				expect(info.size).toBeGreaterThan(0)
			}
		} finally {
			rmSync(mp4Path, { force: true })
		}
	}, 30_000)

	async function seedVideoResource(
		name: string,
	): Promise<{ id: string; mp4Path: string } | undefined> {
		const ffmpeg = resolveFfmpegPaths()
		const mp4Path = join(
			tmpdir(),
			`thumb-mp4-${Date.now()}-${Math.random().toString(36).slice(2)}.mp4`,
		)
		const generated = await new Promise<boolean>((resolve) => {
			const child = spawn(
				ffmpeg.ffmpeg,
				[
					"-hide_banner",
					"-loglevel",
					"error",
					"-f",
					"lavfi",
					"-i",
					"color=c=red:s=64x64:d=0.2",
					"-c:v",
					"libx264",
					"-pix_fmt",
					"yuv420p",
					"-y",
					mp4Path,
				],
				{ stdio: "ignore" },
			)
			child.on("error", () => resolve(false))
			child.on("close", (code) => resolve(code === 0))
		})
		if (!generated) return undefined
		const r = await resources.create({ name })
		await seedResourceArtifact({ db: dbh, paths }, r.id, [
			{ name: "clip.mp4", bytes: await readFile(mp4Path) },
		])
		await resources.setContentPluginId(r.id, TEST_BUILTIN_ID)
		await resources.rebuildAllMeta(r.id)
		return { id: r.id, mp4Path }
	}

	test("zip-backed mp4 renders straight from the materialized entry (no stream attempt)", async () => {
		const seeded = await seedVideoResource("video-direct")
		if (seeded === undefined) return
		try {
			const spy = vi.mocked(renderVideoFrame)
			spy.mockClear()
			const thumbs = createThumbService({
				paths,
				resources,
				ffmpeg: resolveFfmpegPaths(),
			})
			const result = await thumbs.getCover(seeded.id)
			expect(result.kind).toBe("ready")
			// Exactly one render, sourced from the materialized file path —
			// the old stream-first attempt would show a Readable source
			// followed by a seekable retry.
			expect(spy).toHaveBeenCalledTimes(1)
			expect(typeof spy.mock.calls[0]?.[0]?.source).toBe("string")
		} finally {
			rmSync(seeded.mp4Path, { force: true })
		}
	}, 30_000)

	test("literal video entries render straight from the file — no extracted cache", async () => {
		const seeded = await seedVideoResource("video-cache")
		if (seeded === undefined) return
		try {
			const thumbs = createThumbService({
				paths,
				resources,
				ffmpeg: resolveFfmpegPaths(),
			})
			const first = await thumbs.getCover(seeded.id)
			expect(first.kind).toBe("ready")
			const fileVersion = await resources.getFileVersion(seeded.id)
			// Bare-file sources never materialize: the extracted cache must
			// not exist, and a re-render reads the source file directly.
			const extractedPath = paths.local.resExtractedEntry(
				seeded.id,
				fileVersion,
				"clip.mp4",
			)
			await expect(stat(extractedPath)).rejects.toThrow()
			if (first.kind === "ready") await rm(first.path, { force: true })
			const second = await thumbs.getCover(seeded.id)
			expect(second.kind).toBe("ready")
		} finally {
			rmSync(seeded.mp4Path, { force: true })
		}
	}, 30_000)

	test("a second call after synthesis returns the cached file without re-running the pipeline", async () => {
		const png = await pngBuffer({ r: 12, g: 34, b: 56 })
		const r = await prepareImageResource(resources, dbh, paths, "img", png)

		let calls = 0
		const originalResolve = resources.resolveLocalCoverSource.bind(resources)
		const spiedResources: ResService = {
			...resources,
			resolveLocalCoverSource: async (id: string) => {
				calls += 1
				return originalResolve(id)
			},
		}
		const thumbs = createThumbService({ paths, resources: spiedResources })
		await thumbs.getCover(r.id)
		await thumbs.getCover(r.id)
		expect(calls).toBe(1)
	})

	test("resolveFfmpegPaths honours explicit env overrides", () => {
		const paths = resolveFfmpegPaths({
			env: {
				FFMPEG_PATH: "C:/bin/ffmpeg.exe",
				FFPROBE_PATH: "C:/bin/ffprobe.exe",
			},
			loadStatic: () => "C:/static/ffmpeg.exe",
			loadStaticFfprobe: () => "C:/static/ffprobe.exe",
		})
		expect(paths.ffmpeg).toBe("C:/bin/ffmpeg.exe")
		expect(paths.ffprobe).toBe("C:/bin/ffprobe.exe")
	})

	test("resolveFfmpegPaths falls back to installer binaries when no env override", () => {
		const paths = resolveFfmpegPaths({
			env: {},
			loadStatic: () => "/node_modules/ffmpeg-static/ffmpeg",
			loadStaticFfprobe: () => "/node_modules/ffprobe-static/ffprobe",
		})
		expect(paths.ffmpeg).toBe("/node_modules/ffmpeg-static/ffmpeg")
		expect(paths.ffprobe).toBe("/node_modules/ffprobe-static/ffprobe")
	})

	test("resolveFfmpegPaths falls back to PATH lookup when static is unavailable", () => {
		const paths = resolveFfmpegPaths({
			env: {},
			loadStatic: () => undefined,
			loadStaticFfprobe: () => undefined,
		})
		expect(paths.ffmpeg).toBe("ffmpeg")
		expect(paths.ffprobe).toBe("ffprobe")
	})
})

describe("thumb service — getFilePreview variants", () => {
	let root: string
	let dbh: DbHandles
	let paths: StoragePaths
	let resources: ResService

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-file-preview-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		paths = createStoragePaths({ root })
		resources = createResourceService({
			db: dbh.db,
			paths,
			pluginHooks: createTestHooks(),
			readOnly: { current: false },
		})
	})

	afterEach(async () => {
		dbh.close()
		sharp.cache(false)
		for (let attempt = 0; attempt < 5; attempt++) {
			try {
				rmSync(root, { recursive: true, force: true })
				return
			} catch (err) {
				if (attempt === 4) throw err
				await new Promise((r) => setTimeout(r, 50 * (attempt + 1)))
			}
		}
	})

	/** A 2400×2400 PNG — 5.76 MP, above the 4 MP preview cap. */
	async function bigPngBuffer(): Promise<Buffer> {
		return sharp({
			create: {
				width: 2400,
				height: 2400,
				channels: 3,
				background: { r: 40, g: 80, b: 120 },
			},
		})
			.png()
			.toBuffer()
	}

	test("default spec renders an avif and answers from the cache on repeat", async () => {
		const png = await bigPngBuffer()
		const r = await prepareImageResource(resources, dbh, paths, "img", png)

		const thumbs = createThumbService({ paths, resources })
		const first = await thumbs.getFilePreview(r.id, "a.png")
		expect(first.kind).toBe("ready")
		if (first.kind !== "ready") throw new Error("expected ready")
		expect(first.format).toBe("avif")
		expect(first.path).toContain("file-preview")

		const second = await thumbs.getFilePreview(r.id, "a.png")
		expect(second.kind).toBe("ready")
		// Cache hit: the same variant key yields the same file.
		expect(second.kind === "ready" && second.path).toBe(first.path)
	})

	test("inside fit downscales beyond the area cap", async () => {
		const png = await bigPngBuffer()
		const r = await prepareImageResource(resources, dbh, paths, "img", png)

		const thumbs = createThumbService({ paths, resources })
		const result = await thumbs.getFilePreview(r.id, "a.png")
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") throw new Error("expected ready")
		const meta = await sharp(result.path).metadata()
		expect(meta.width).toBe(2000)
		expect(meta.height).toBe(2000)
	})

	test("exact fit preserves source dimensions beyond the area cap", async () => {
		const png = await bigPngBuffer()
		const r = await prepareImageResource(resources, dbh, paths, "img", png)

		const thumbs = createThumbService({ paths, resources })
		const result = await thumbs.getFilePreview(r.id, "a.png", {
			fit: "exact",
		})
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") throw new Error("expected ready")
		expect(result.format).toBe("avif")
		const meta = await sharp(result.path).metadata()
		expect(meta.width).toBe(2400)
		expect(meta.height).toBe(2400)
	})

	test("exact webp transcodes to webp at source dimensions", async () => {
		const png = await bigPngBuffer()
		const r = await prepareImageResource(resources, dbh, paths, "img", png)

		const thumbs = createThumbService({ paths, resources })
		const result = await thumbs.getFilePreview(r.id, "a.png", {
			format: "webp",
			fit: "exact",
		})
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") throw new Error("expected ready")
		expect(result.format).toBe("webp")
		const meta = await sharp(result.path).metadata()
		expect(meta.width).toBe(2400)
		expect(meta.height).toBe(2400)
	})

	test("distinct specs land on distinct cache files", async () => {
		const png = await bigPngBuffer()
		const r = await prepareImageResource(resources, dbh, paths, "img", png)

		const thumbs = createThumbService({ paths, resources })
		const inside = await thumbs.getFilePreview(r.id, "a.png")
		const exact = await thumbs.getFilePreview(r.id, "a.png", {
			fit: "exact",
		})
		expect(inside.kind).toBe("ready")
		expect(exact.kind).toBe("ready")
		expect(inside.kind === "ready" && inside.path).not.toBe(
			exact.kind === "ready" ? exact.path : "",
		)
	})

	test("getFilePreview falls back to the trash entry after hard delete", async () => {
		const png = await pngBuffer({ r: 40, g: 60, b: 80 })
		const r = await prepareImageResource(resources, dbh, paths, "trashed", png)
		await resources.softDelete(r.id)
		await resources.hardDelete(r.id)

		const thumbs = createThumbService({ paths, resources })
		const result = await thumbs.getFilePreview(r.id, "a.png")
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") throw new Error("expected ready")
		expect(result.format).toBe("avif")
		// The rendered file is decodable (sharp reports the HEIF container).
		const meta = await sharp(result.path).metadata()
		expect(meta.format).toBe("heif")
	})

	test("getFilePreview stays unavailable without a trash entry", async () => {
		const png = await pngBuffer({ r: 10, g: 20, b: 30 })
		const r = await prepareImageResource(resources, dbh, paths, "gone", png)
		await resources.softDelete(r.id)
		await resources.hardDelete(r.id)
		// Remove the trash entry the hard delete created.
		await rm(paths.local.trash(), { recursive: true, force: true })

		const thumbs = createThumbService({ paths, resources })
		const result = await thumbs.getFilePreview(r.id, "a.png")
		expect(result.kind).toBe("unavailable")
	})
})
