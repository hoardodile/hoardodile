import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { readImageMetadata } from "@hoardodile/host/probe"
import { ANIMATED_AREA_DIVISOR } from "@hoardodile/host/render"
import {
	RESOURCE_COVER_MAX_AREA,
	RESOURCE_PREVIEW_MAX_AREA,
} from "@hoardodile/sdk-types/resource"
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
import { createThumbService } from "./service.ts"

vi.mock("@hoardodile/host/probe", async (importOriginal) => {
	const actual = await importOriginal<typeof import("@hoardodile/host/probe")>()
	return {
		...actual,
		readImageMetadata: vi.fn(),
	}
})

async function largePngBuffer(): Promise<Buffer> {
	return sharp({
		create: {
			width: 600,
			height: 600,
			channels: 3,
			background: { r: 128, g: 128, b: 128 },
		},
	})
		.png()
		.toBuffer()
}

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
	await resources.rebuildAllMeta(r.id)
	return r
}

describe("thumb service — animated area reduction", () => {
	let root: string
	let dbh: DbHandles
	let paths: StoragePaths
	let resources: ResService

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-local-thumbs-anim-"))
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

	test("animated source uses 1/3 max area", async () => {
		const png = await largePngBuffer()
		const sourceMeta = await sharp(png).metadata()
		vi.mocked(readImageMetadata).mockResolvedValue({
			meta: { ...sourceMeta, pages: 2 },
			animated: true,
		})

		const r = await prepareImageResource(resources, dbh, paths, "anim", png)

		const thumbs = createThumbService({ paths, resources })
		const result = await thumbs.getCover(r.id)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") throw new Error("expected ready")

		const meta = await sharp(result.path).metadata()
		expect(meta.width).toBeGreaterThan(0)
		expect(meta.height).toBeGreaterThan(0)
		const area = meta.width! * meta.height!
		const animatedMaxArea = Math.floor(
			RESOURCE_COVER_MAX_AREA / ANIMATED_AREA_DIVISOR,
		)
		expect(area).toBeLessThanOrEqual(animatedMaxArea)
		expect(result.format).toBe("webp")
	})

	test("non-animated source uses full max area", async () => {
		const png = await largePngBuffer()
		const sourceMeta = await sharp(png).metadata()
		vi.mocked(readImageMetadata).mockResolvedValue({
			meta: sourceMeta,
			animated: false,
		})

		const r = await prepareImageResource(resources, dbh, paths, "still", png)

		const thumbs = createThumbService({ paths, resources })
		const result = await thumbs.getCover(r.id)
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") throw new Error("expected ready")

		const meta = await sharp(result.path).metadata()
		expect(meta.width).toBeGreaterThan(0)
		expect(meta.height).toBeGreaterThan(0)
		const area = meta.width! * meta.height!
		expect(area).toBeLessThanOrEqual(RESOURCE_COVER_MAX_AREA)
		expect(result.format).toBe("avif")
	})

	test("getFilePreview downgrades an animated source to webp", async () => {
		const png = await largePngBuffer()
		const sourceMeta = await sharp(png).metadata()
		vi.mocked(readImageMetadata).mockResolvedValue({
			meta: { ...sourceMeta, pages: 2 },
			animated: true,
		})

		const r = await prepareImageResource(resources, dbh, paths, "anim", png)

		const thumbs = createThumbService({ paths, resources })
		const result = await thumbs.getFilePreview(r.id, "a.png")
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") throw new Error("expected ready")
		expect(result.format).toBe("webp")
		const meta = await sharp(result.path).metadata()
		const animatedMaxArea = Math.floor(
			RESOURCE_PREVIEW_MAX_AREA / ANIMATED_AREA_DIVISOR,
		)
		expect(meta.width! * meta.height!).toBeLessThanOrEqual(animatedMaxArea)
	})

	test("getFilePreview exact keeps an animated source at full dimensions", async () => {
		const png = await largePngBuffer()
		const sourceMeta = await sharp(png).metadata()
		vi.mocked(readImageMetadata).mockResolvedValue({
			meta: { ...sourceMeta, pages: 2 },
			animated: true,
		})

		const r = await prepareImageResource(resources, dbh, paths, "anim", png)

		const thumbs = createThumbService({ paths, resources })
		const result = await thumbs.getFilePreview(r.id, "a.png", {
			fit: "exact",
		})
		expect(result.kind).toBe("ready")
		if (result.kind !== "ready") throw new Error("expected ready")
		expect(result.format).toBe("webp")
		const meta = await sharp(result.path).metadata()
		expect(meta.width).toBe(600)
		expect(meta.height).toBe(600)
	})
})
