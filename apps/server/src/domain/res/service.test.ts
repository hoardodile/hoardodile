import {
	existsSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { PluginRegistry } from "@hoardodile/host"
import { buildRegistry, createPluginHooks } from "@hoardodile/host"
import type { PluginDefinition, ResourceAPI } from "@hoardodile/sdk-server"
import { DomainError } from "@hoardodile/shared"
import { eq } from "drizzle-orm"
import { resCollectionItems, resCollections } from "src/domain/col/schema.ts"
import {
	getMetaBuildCalls,
	getMetaBuildPeak,
	resetMetaBuildTracking,
	setMetaBuildDelay,
	TEST_BUILTIN_ID,
	TEST_BUILTIN_MANIFEST,
	trackMetaBuild,
} from "./test-registry.ts"
import { seedResourceArtifact } from "./test-seed.ts"

// ---- Inline plugin stubs (replaces deleted in-memory-plugins.ts) ----

const IMAGE_PLUGIN_ID = "11111111-1111-4111-8111-111111111111"
const TEXT_PLUGIN_ID = "22222222-2222-4222-8222-222222222222"

function createImageStub(): PluginDefinition {
	return {
		detect: async (api: ResourceAPI) => {
			const entries = await api.listFileNames()
			const hasImage = entries.some((n) =>
				/\.(jpg|jpeg|png|webp|gif)$/i.test(n),
			)
			return hasImage ? { ok: true } : { ok: false, reasons: ["page-image"] }
		},
	}
}

function createTextStub(): PluginDefinition {
	return {
		detect: async (api: ResourceAPI) => {
			const entries = await api.listFileNames()
			const hasText = entries.some((n) => /\.(txt|md|epub)$/i.test(n))
			return hasText ? { ok: true } : { ok: false, reasons: ["text-file"] }
		},
	}
}

function extname(filename: string): string {
	const dot = filename.lastIndexOf(".")
	if (dot === -1) return ""
	return filename.slice(dot).toLowerCase()
}

function inferType(filename: string): "image" | "video" | "audio" | undefined {
	const ext = extname(filename)
	if (
		ext === ".jpg" ||
		ext === ".jpeg" ||
		ext === ".png" ||
		ext === ".webp" ||
		ext === ".gif" ||
		ext === ".bmp" ||
		ext === ".avif"
	)
		return "image"
	if (
		ext === ".mp4" ||
		ext === ".webm" ||
		ext === ".mov" ||
		ext === ".mkv" ||
		ext === ".m4v" ||
		ext === ".avi"
	)
		return "video"
	if (
		ext === ".mp3" ||
		ext === ".flac" ||
		ext === ".ogg" ||
		ext === ".m4a" ||
		ext === ".wav" ||
		ext === ".opus"
	)
		return "audio"
	return undefined
}

function createGalleryStub(): PluginDefinition {
	return {
		detect: async () => ({ ok: true }),
		sourceMeta: async () =>
			trackMetaBuild(async () => ({
				coverKind: "image" as const,
				width: 1,
				height: 1,
			})),
		listFiles: async (api: ResourceAPI) => {
			const files = await api.listFileNames()
			const sorted = [...files].sort((a, b) =>
				a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
			)
			return sorted.map((filename) => {
				const type = inferType(filename)
				return type === undefined ? { filename } : { filename, type }
			})
		},
	}
}

const IN_MEMORY_STUBS = [
	{
		id: IMAGE_PLUGIN_ID,
		manifest: {
			id: IMAGE_PLUGIN_ID,
			name: "Pages",
			description: "",
			version: "1.0.0",
			permissions: {
				sourceMeta: false,
				searchMeta: false,
				danmaku: false,
				message: false,
				imageHashes: false,
				preferences: false,
				node: false,
				container: false,
				download: false,
			},
		},
		priority: 50,
		plugin: createImageStub(),
	},
	{
		id: TEXT_PLUGIN_ID,
		manifest: {
			id: TEXT_PLUGIN_ID,
			name: "Text",
			description: "",
			version: "1.0.0",
			permissions: {
				sourceMeta: false,
				searchMeta: false,
				danmaku: false,
				message: false,
				imageHashes: false,
				preferences: false,
				node: false,
				container: false,
				download: false,
			},
		},
		priority: 60,
		plugin: createTextStub(),
	},
]

import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import {
	createStoragePaths,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { resourceHashes, resourceMeta, resources } from "./schema.ts"
import { createResourceService, type ResService } from "./service.ts"

function createTestRegistry() {
	return buildRegistry([
		{
			id: TEST_BUILTIN_ID,
			manifest: TEST_BUILTIN_MANIFEST,
			enabled: true,
			priority: Number.MAX_SAFE_INTEGER,
			pinned: false,
			color: "",
			missing: false,
			builtin: true,
			dev: false,
			plugin: createGalleryStub(),
		},
		...IN_MEMORY_STUBS.map((def) => ({
			id: def.id,
			manifest: def.manifest,
			enabled: true,
			priority: def.priority,
			pinned: false,
			color: "",
			missing: false,
			builtin: false,
			dev: false,
			plugin: def.plugin,
		})),
	])
}

function createTestHooks() {
	return createPluginHooks({ getRegistry: () => createTestRegistry() })
}

describe("resource service", () => {
	let root: string
	let dbh: DbHandles
	let paths: StoragePaths
	let svc: ResService

	beforeEach(() => {
		resetMetaBuildTracking()
		root = mkdtempSync(join(tmpdir(), "app-resource-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		paths = createStoragePaths({ root })
		svc = createResourceService({
			db: dbh.db,
			paths,
			pluginHooks: createTestHooks(),
			readOnly: { current: false },
		})
	})

	afterEach(async () => {
		await svc.drainMetaQueue()
		dbh.close()
		// Windows holds sharp/archive file handles briefly after the
		// awaited work settles — retry the cleanup instead of flaking.
		for (let attempt = 0; ; attempt++) {
			try {
				rmSync(root, { recursive: true, force: true })
				break
			} catch (err) {
				if (attempt >= 4) throw err
				await new Promise((resolve) => setTimeout(resolve, 100))
			}
		}
	})

	test("create persists the row and creates the resource folder", async () => {
		const r = await svc.create({ name: "Hello" })
		expect(r.id).toBeTruthy()
		expect(r.name).toBe("Hello")
		expect(r.intro).toBe("")
		expect(r.tagIds).toEqual([])
		expect(r.charIds).toEqual([])
		expect(existsSync(paths.active.resource(r.id))).toBe(true)
	})

	test("source fields round-trip through create and update", async () => {
		const created = await svc.create({
			name: "sourced",
			sourceName: "FirstSite",
			sourceUrl: "https://example.com/item/1",
		})
		expect(created.sourceName).toBe("FirstSite")
		expect(created.sourceUrl).toBe("https://example.com/item/1")

		// An empty string clears a source field; undefined leaves it alone.
		const cleared = await svc.update({
			id: created.id,
			sourceUrl: "   ",
			sourceName: "SecondSite",
		})
		expect(cleared.sourceName).toBe("SecondSite")
		expect(cleared.sourceUrl).toBeUndefined()

		const untouched = await svc.update({ id: created.id, name: "renamed" })
		expect(untouched.sourceName).toBe("SecondSite")
		expect(untouched.sourceUrl).toBeUndefined()

		const noSource = await svc.create({ name: "plain" })
		expect(noSource.sourceName).toBeUndefined()
		expect(noSource.sourceUrl).toBeUndefined()
	})

	test("full lifecycle: create -> list -> detail -> edit -> soft -> trash -> restore -> soft -> hard", async () => {
		const a = await svc.create({ name: "alpha" })
		const b = await svc.create({ name: "beta" })
		expect((await svc.list({})).total).toBe(2)
		expect((await svc.detail(a.id)).name).toBe("alpha")

		const edited = await svc.update({
			id: a.id,
			name: "alpha-updated",
			intro: "notes",
		})
		expect(edited.name).toBe("alpha-updated")
		expect(edited.intro).toBe("notes")

		const trashed = await svc.softDelete(a.id)
		expect(trashed.deletedAt).toBeTypeOf("number")
		expect((await svc.list({})).rows.map((r) => r.id)).toEqual([b.id])
		expect((await svc.trashList({})).rows.map((r) => r.id)).toEqual([a.id])

		const restored = await svc.restore(a.id)
		expect(restored.deletedAt).toBeUndefined()
		expect((await svc.list({})).total).toBe(2)

		await svc.softDelete(a.id)
		const result = await svc.hardDelete(a.id)
		expect(result.trashedPath.startsWith(paths.local.trash())).toBe(true)
		expect(result.trashedPath).toContain(a.id)
		expect(existsSync(paths.active.resource(a.id))).toBe(false)
		expect(existsSync(result.trashedPath)).toBe(true)
		expect(existsSync(paths.active.deletedMarker("resources", a.id))).toBe(
			false,
		)
		await expect(svc.detail(a.id)).rejects.toThrow(DomainError)
	})

	test("soft delete leaves the resource folder byte-identical on disk", async () => {
		const r = await svc.create({ name: "keep-me" })
		const file = join(paths.active.resource(r.id), "payload.bin")
		const contents = Buffer.from([0, 1, 2, 3, 4, 5])
		writeFileSync(file, contents)
		await svc.softDelete(r.id)
		expect(existsSync(file)).toBe(true)
		const after = readFileSync(file)
		expect(after.equals(contents)).toBe(true)
	})

	test("hard delete refuses unless the row is already soft-deleted", async () => {
		const r = await svc.create({ name: "still-live" })
		await expect(svc.hardDelete(r.id)).rejects.toBeInstanceOf(DomainError)
		expect(existsSync(paths.active.resource(r.id))).toBe(true)
		expect((await svc.detail(r.id)).id).toBe(r.id)
	})

	test("restore refuses on a live row; soft-delete refuses on an already-trashed row", async () => {
		const r = await svc.create({ name: "double" })
		await expect(svc.restore(r.id)).rejects.toThrow(DomainError)
		await svc.softDelete(r.id)
		await expect(svc.softDelete(r.id)).rejects.toThrow(DomainError)
	})

	test("search excludes soft-deleted rows and re-includes them after restore", async () => {
		const a = await svc.create({ name: "Apple" })
		const b = await svc.create({ name: "Banana" })
		expect((await svc.list({ query: "apple" })).rows.map((r) => r.id)).toEqual([
			a.id,
		])
		expect((await svc.list({ query: "BANANA" })).rows.map((r) => r.id)).toEqual(
			[b.id],
		)
		await svc.softDelete(a.id)
		expect((await svc.list({ query: "apple" })).total).toBe(0)
		expect(
			(await svc.trashList({ query: "apple" })).rows.map((r) => r.id),
		).toEqual([a.id])
		await svc.restore(a.id)
		expect((await svc.list({ query: "apple" })).total).toBe(1)
	})

	test("LIKE search escapes %, _, and backslash so they match literally", async () => {
		const pct = await svc.create({ name: "100% complete" })
		await svc.create({ name: "100 complete" })
		const under = await svc.create({ name: "a_b pair" })
		await svc.create({ name: "axb pair" })
		const winPath = await svc.create({
			// path-guard-exempt: fixture data, not a filesystem path expectation.
			name: "C:\\app\\x.png",
		})

		expect((await svc.list({ query: "100%" })).rows.map((r) => r.id)).toEqual([
			pct.id,
		])
		expect((await svc.list({ query: "a_b" })).rows.map((r) => r.id)).toEqual([
			under.id,
		])
		expect((await svc.list({ query: "\\app" })).rows.map((r) => r.id)).toEqual([
			winPath.id,
		])
	})

	test("search matches either name or intro", async () => {
		const a = await svc.create({
			name: "vacation",
			intro: "beach sand",
		})
		const b = await svc.create({
			name: "receipts",
			intro: "vacation trip",
		})
		const ids = (await svc.list({ query: "vacation", searchIntro: true })).rows
			.map((r) => r.id)
			.sort()
		expect(ids).toEqual([a.id, b.id].sort())
	})

	test("list paginates in createdAt DESC order", async () => {
		const ids: string[] = []
		let t = 1_000
		const svcTs = createResourceService({
			db: dbh.db,
			paths,
			pluginHooks: createTestHooks(),
			readOnly: { current: false },
			now: () => {
				t += 1
				return t
			},
		})
		for (const name of ["a", "b", "c", "d", "e"]) {
			ids.push((await svcTs.create({ name })).id)
		}
		const page1 = await svcTs.list({ size: 2, page: 1 })
		const page2 = await svcTs.list({ size: 2, page: 2 })
		expect(page1.total).toBe(5)
		expect(page1.rows.map((r) => r.id)).toEqual([ids[4], ids[3]])
		expect(page2.rows.map((r) => r.id)).toEqual([ids[2], ids[1]])
	})

	test("batch creates get strictly increasing timestamps so list order matches upload order", async () => {
		const svcFixed = createResourceService({
			db: dbh.db,
			paths,
			pluginHooks: createTestHooks(),
			readOnly: { current: false },
			// A frozen clock simulates back-to-back batch creates landing
			// in the same millisecond — the guard must still order them.
			now: () => 5_000,
		})
		const created: string[] = []
		for (const name of ["one", "two", "three"]) {
			created.push((await svcFixed.create({ name })).id)
		}
		const rows = (await svcFixed.list({})).rows
		expect(rows.map((r) => r.id)).toEqual([...created].reverse())
		const details = rows.map((r) => svcFixed.detail(r.id))
		expect((await details[2]!).createdAt).toBeLessThan(
			(await details[1]!).createdAt,
		)
		expect((await details[1]!).createdAt).toBeLessThan(
			(await details[0]!).createdAt,
		)
	})

	test("detail on a missing id throws a typed NOT_FOUND domain error", async () => {
		try {
			await svc.detail("nope")
			expect.unreachable("detail should have thrown")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			if (err instanceof DomainError) {
				expect(err.code).toBe("NOT_FOUND")
				expect(err.kind).toBe("resource.not_found")
			}
		}
	})

	test("setContentType returns structured failure when detector rejects", async () => {
		const r = await svc.create({ name: "g" })
		const result = await svc.setContentPluginId(r.id, IMAGE_PLUGIN_ID)
		expect(result.ok).toBe(false)
		if (!result.ok) {
			expect(result.failure.reasons.length).toBeGreaterThan(0)
		}
		expect((await svc.detail(r.id)).contentPluginId).toBeNull()
	})

	test("setContentType commits when the detector passes", async () => {
		const r = await svc.create({ name: "m" })
		await seedResourceArtifact({ db: dbh, paths }, r.id, [
			{ name: "page.png", bytes: Buffer.alloc(0) },
		])
		const result = await svc.setContentPluginId(r.id, IMAGE_PLUGIN_ID)
		expect(result.ok).toBe(true)
		if (result.ok) {
			expect(result.resource.contentPluginId).toBe(IMAGE_PLUGIN_ID)
		}
		expect((await svc.detail(r.id)).contentPluginId).toBe(IMAGE_PLUGIN_ID)
	})

	test("setContentType is idempotent when the type is unchanged", async () => {
		const r = await svc.create({ name: "g2" })
		const result = await svc.setContentPluginId(r.id, TEST_BUILTIN_ID)
		expect(result.ok).toBe(true)
	})

	test("listFiles returns top-level files only, sorted, without directories or dotfiles", async () => {
		const r = await svc.create({
			name: "list",
			contentPluginId: TEST_BUILTIN_ID,
		})
		// Seed three bare image files. Dotfiles and sub-paths are not part
		// of the top-level listing, so this test just verifies the natural
		// sort.
		await seedResourceArtifact({ db: dbh, paths }, r.id, [
			{ name: "b.png", bytes: Buffer.alloc(0) },
			{ name: "a.png", bytes: Buffer.alloc(0) },
			{ name: "10.png", bytes: Buffer.alloc(0) },
		])
		const names = (await svc.listFiles(r.id)) as {
			readonly filename: string
			readonly type?: string
		}[]
		expect(names.map((f) => f.filename)).toEqual(["10.png", "a.png", "b.png"])
		// The fixture does not wire real probes, so width/height stay absent.
		expect(names.every((f) => f.type === "image")).toBe(true)
	})

	test("listFiles returns empty array for a brand-new gallery resource (no throw)", async () => {
		const r = await svc.create({ name: "empty" })
		expect(await svc.listFiles(r.id)).toEqual([])
	})

	test("rebuildPluginMeta is a no-op when no builder is configured", async () => {
		const r = await svc.create({ name: "no-build" })
		await svc.rebuildPluginMeta(r.id)
		expect((await svc.detail(r.id)).sourceMeta).toBeUndefined()
	})

	test("rebuildPluginMeta persists the builder result", async () => {
		const r = await svc.create({
			name: "with-build",
			contentPluginId: TEST_BUILTIN_ID,
		})
		await svc.rebuildPluginMeta(r.id)
		expect((await svc.detail(r.id)).sourceMeta).toEqual({
			coverKind: "image",
			width: 1,
			height: 1,
		})
	})

	test("detail awaits meta rebuild when sourceMeta is missing", async () => {
		const r = await svc.create({
			name: "lazy",
			contentPluginId: TEST_BUILTIN_ID,
		})
		const resource = await svc.detail(r.id)
		expect(getMetaBuildCalls()).toBeGreaterThanOrEqual(1)
		expect(resource.sourceMeta).toEqual({
			coverKind: "image",
			width: 1,
			height: 1,
		})
	})

	test("source-meta queue dedupes concurrent rebuilds for the same id", async () => {
		resetMetaBuildTracking()
		setMetaBuildDelay(5)
		const r = await svc.create({
			name: "dedupe",
			contentPluginId: TEST_BUILTIN_ID,
		})
		// Fire a burst; only one job should be in flight at a time per id.
		for (let i = 0; i < 5; i++) {
			svc.enqueuePluginMetaRebuild(r.id)
		}
		await new Promise((resolve) => setTimeout(resolve, 50))
		expect(getMetaBuildPeak()).toBe(1)
	})

	test("setContentType clears derived artifacts on transition", async () => {
		const r = await svc.create({ name: "ct" })
		await seedResourceArtifact({ db: dbh, paths }, r.id, [
			{ name: "p.png", bytes: Buffer.alloc(0) },
		])
		const result = await svc.setContentPluginId(r.id, IMAGE_PLUGIN_ID)
		expect(result.ok).toBe(true)
		expect((await svc.detail(r.id)).contentPluginId).toBe(IMAGE_PLUGIN_ID)
	})

	test("hardDelete clears derived artifacts and moves versions folder to host trash", async () => {
		const r = await svc.create({ name: "purge" })
		// Simulate a previously-rendered derived artifact.
		const { mkdirSync } = await import("node:fs")
		const localResourceDir = paths.local.resource(r.id)
		mkdirSync(localResourceDir, { recursive: true })
		const thumbFile = join(localResourceDir, "preview.webp")
		writeFileSync(thumbFile, "")
		await svc.softDelete(r.id)
		const result = await svc.hardDelete(r.id)
		expect(result.trashedPath.startsWith(paths.local.trash())).toBe(true)
		expect(existsSync(result.trashedPath)).toBe(true)
		expect(existsSync(paths.active.resource(r.id))).toBe(false)
		expect(existsSync(paths.active.deletedMarker("resources", r.id))).toBe(
			false,
		)
		expect(existsSync(thumbFile)).toBe(false)
	})

	test("hardDelete writes .deleted only when fileVersion points at a past archive", async () => {
		paths = createStoragePaths({ root, latestVersion: 2 })
		svc = createResourceService({
			db: dbh.db,
			paths,
			pluginHooks: createTestHooks(),
			readOnly: { current: false },
		})
		const r = await svc.create({ name: "legacy" })
		dbh.db
			.update(resources)
			.set({ fileVersion: 1 })
			.where(eq(resources.id, r.id))
			.run()
		await svc.softDelete(r.id)
		const result = await svc.hardDelete(r.id)
		expect(result.trashedPath).toContain(".deleted")
		expect(existsSync(paths.latest.deletedMarker("resources", r.id))).toBe(true)
	})

	test("softDeleteMany moves live rows and collects already-trashed ids", async () => {
		const a = await svc.create({ name: "a" })
		const b = await svc.create({ name: "b" })
		await svc.softDelete(b.id)
		const r = await svc.softDeleteMany([a.id, b.id, a.id])
		expect(r.okIds).toEqual([a.id])
		expect(r.failures).toHaveLength(1)
		expect(r.failures[0]?.id).toBe(b.id)
		expect((await svc.list({})).total).toBe(0)
		const trashIds = (await svc.trashList({})).rows.map((x) => x.id).sort()
		expect(trashIds).toEqual([a.id, b.id].sort())
	})

	test("hardDeleteMany purges trashed rows and collects live ids as failures", async () => {
		const a = await svc.create({ name: "a" })
		const b = await svc.create({ name: "b" })
		await svc.softDelete(a.id)
		const r = await svc.hardDeleteMany([a.id, b.id])
		expect(r.okIds).toEqual([a.id])
		expect(r.failures).toHaveLength(1)
		expect(r.failures[0]?.id).toBe(b.id)
		await expect(svc.detail(a.id)).rejects.toThrow(DomainError)
		expect((await svc.detail(b.id)).id).toBe(b.id)
	})

	describe("cover across versions", () => {
		test("setCover bumps coverVersion to latestVersion", async () => {
			const r = await svc.create({ name: "cover-bump" })
			await svc.setCover(r.id, ".jpg", Buffer.from("cover1"))
			await new Promise((resolve) => setTimeout(resolve, 100))
			const row = dbh.db
				.select()
				.from(resources)
				.where(eq(resources.id, r.id))
				.get()
			expect(row?.coverVersion).toBe(1)
			expect((await svc.detail(r.id)).coverMeta).toBeTruthy()
		})

		test("setCover rejects non-image extension", async () => {
			const r = await svc.create({ name: "video-cover" })
			await expect(
				svc.setCover(r.id, ".mp4", Buffer.from("fake-video")),
			).rejects.toThrow(DomainError)
		})

		test("legacy resource can update cover after version publish", async () => {
			// Create and cover a resource in version 1
			const r = await svc.create({ name: "legacy-cover" })
			await svc.setCover(r.id, ".jpg", Buffer.from("old-cover"))
			expect(existsSync(join(paths.active.resource(r.id), ".cover.jpg"))).toBe(
				true,
			)

			// Simulate a version publish: current becomes 2
			paths = createStoragePaths({ root, latestVersion: 2 })
			svc = createResourceService({
				db: dbh.db,
				paths,
				pluginHooks: createTestHooks(),
				readOnly: { current: false },
			})

			// Mark the resource as legacy (source lives in v1)
			dbh.db
				.update(resources)
				.set({ fileVersion: 1 })
				.where(eq(resources.id, r.id))
				.run()

			// Cover update should succeed and move to current version
			await svc.setCover(r.id, ".png", Buffer.from("new-cover"))

			await new Promise((resolve) => setTimeout(resolve, 100))

			const row = dbh.db
				.select()
				.from(resources)
				.where(eq(resources.id, r.id))
				.get()
			expect(row?.coverVersion).toBe(2)
			expect((await svc.detail(r.id)).coverMeta).toBeTruthy()

			// findCover resolves from the new version
			const coverPath = await svc.findCover(r.id)
			expect(coverPath).toContain(".cover.png")
			expect(coverPath?.startsWith(paths.atVersion(2).resource(r.id))).toBe(
				true,
			)

			// Old cover in the archived version is untouched
			expect(
				existsSync(join(paths.atVersion(1).resource(r.id), ".cover.jpg")),
			).toBe(true)

			// Allow background meta-ops queue to settle before teardown
			await new Promise((r) => setTimeout(r, 100))
		})

		test("legacy resource can clear cover after version publish", async () => {
			const r = await svc.create({ name: "legacy-clear" })
			await svc.setCover(r.id, ".jpg", Buffer.from("old-cover"))

			paths = createStoragePaths({ root, latestVersion: 2 })
			svc = createResourceService({
				db: dbh.db,
				paths,
				pluginHooks: createTestHooks(),
				readOnly: { current: false },
			})
			dbh.db
				.update(resources)
				.set({ fileVersion: 1 })
				.where(eq(resources.id, r.id))
				.run()

			await svc.clearCover(r.id)

			const row = dbh.db
				.select()
				.from(resources)
				.where(eq(resources.id, r.id))
				.get()
			expect(row?.coverVersion).toBe(2)
			expect((await svc.detail(r.id)).coverMeta).toEqual({ empty: true })

			// The current-version cover file is gone
			expect(
				existsSync(join(paths.atVersion(2).resource(r.id), ".cover.jpg")),
			).toBe(false)
			// Archived cover remains
			expect(
				existsSync(join(paths.atVersion(1).resource(r.id), ".cover.jpg")),
			).toBe(true)

			// Allow background meta-ops queue to settle before teardown
			await new Promise((r) => setTimeout(r, 100))
		})
	})

	describe("previewPluginId (effective plugin resolution)", () => {
		function registryWithMissingPlugin(): PluginRegistry {
			return buildRegistry([
				{
					id: IMAGE_PLUGIN_ID,
					manifest: {
						id: IMAGE_PLUGIN_ID,
						name: "Pages",
						description: "",
						version: "1.0.0",
						permissions: {
							sourceMeta: false,
							searchMeta: false,
							danmaku: false,
							message: false,
							imageHashes: false,
							container: false,
							download: false,
						},
					},
					enabled: true,
					priority: 100,
					pinned: false,
					color: "",
					missing: true,
					builtin: false,
					dev: false,
					plugin: {
						detect: async () => ({ ok: false, reasons: ["missing"] }),
					},
				},
				...createTestRegistry().getAll(),
			])
		}

		function registryWithDisabledPlugin(): PluginRegistry {
			return buildRegistry([
				{
					id: IMAGE_PLUGIN_ID,
					manifest: {
						id: IMAGE_PLUGIN_ID,
						name: "Pages",
						description: "",
						version: "1.0.0",
						permissions: {
							sourceMeta: false,
							searchMeta: false,
							danmaku: false,
							message: false,
							imageHashes: false,
							container: false,
							download: false,
						},
					},
					enabled: false,
					priority: 100,
					pinned: false,
					color: "",
					missing: false,
					builtin: false,
					dev: false,
					plugin: { detect: async () => ({ ok: true }) },
				},
				...createTestRegistry().getAll(),
			])
		}

		function svcWith(registry: PluginRegistry): ResService {
			return createResourceService({
				db: dbh.db,
				paths,
				pluginHooks: createPluginHooks({ getRegistry: () => registry }),
				readOnly: { current: false },
			})
		}

		test("cards resolve previewPluginId to the stored plugin when healthy", async () => {
			const r = await svc.create({
				name: "healthy",
				contentPluginId: TEST_BUILTIN_ID,
			})
			expect((await svc.detailCard(r.id)).previewPluginId).toBe(TEST_BUILTIN_ID)
			const listed = await svc.listCards({})
			expect(listed.rows[0]?.previewPluginId).toBe(TEST_BUILTIN_ID)
			const related = await svc.relatedByTags(r.id, 10)
			expect(related.every((c) => c.previewPluginId === TEST_BUILTIN_ID)).toBe(
				true,
			)
		})

		test("cards resolve previewPluginId to the builtin when the stored plugin is missing", async () => {
			const r = await svc.create({
				name: "missing",
				contentPluginId: IMAGE_PLUGIN_ID,
			})
			svc = svcWith(registryWithMissingPlugin())
			const card = await svc.detailCard(r.id)
			expect(card.contentPluginId).toBe(IMAGE_PLUGIN_ID)
			expect(card.previewPluginId).toBe(TEST_BUILTIN_ID)
			expect((await svc.listCards({})).rows[0]?.previewPluginId).toBe(
				TEST_BUILTIN_ID,
			)
		})

		test("cards resolve previewPluginId to the builtin when the stored plugin is disabled", async () => {
			const r = await svc.create({
				name: "disabled",
				contentPluginId: IMAGE_PLUGIN_ID,
			})
			svc = svcWith(registryWithDisabledPlugin())
			expect((await svc.detailCard(r.id)).previewPluginId).toBe(TEST_BUILTIN_ID)
		})

		test("cards resolve previewPluginId to the builtin when no plugin is stored", async () => {
			const r = await svc.create({ name: "none" })
			expect((await svc.detailCard(r.id)).previewPluginId).toBe(TEST_BUILTIN_ID)
		})

		test("listFiles delegates to the effective plugin when the stored plugin is missing", async () => {
			const r = await svc.create({
				name: "effective-files",
				contentPluginId: IMAGE_PLUGIN_ID,
			})
			await seedResourceArtifact({ db: dbh, paths }, r.id, [
				{ name: "a.png", bytes: Buffer.alloc(0) },
			])
			svc = svcWith(registryWithMissingPlugin())
			const files = (await svc.listFiles(r.id)) as {
				readonly filename: string
				readonly type?: string
			}[]
			// The builtin gallery stub's listFiles enriches entries with a
			// media type — bare-name fallback would leave `type` absent.
			expect(files.map((f) => f.filename)).toEqual(["a.png"])
			expect(files[0]?.type).toBe("image")
		})

		test("countByContentPluginId counts live resources bound to a plugin", async () => {
			await svc.create({ name: "bound-1", contentPluginId: TEST_BUILTIN_ID })
			await svc.create({ name: "bound-2", contentPluginId: TEST_BUILTIN_ID })
			await svc.create({ name: "unbound" })
			expect(svc.countByContentPluginId(TEST_BUILTIN_ID)).toBe(2)
			expect(svc.countByContentPluginId(IMAGE_PLUGIN_ID)).toBe(0)
		})

		test("replaceContentPlugin switches only the intended resources and clears derived meta atomically", async () => {
			const a = await svc.create({
				name: "a",
				contentPluginId: IMAGE_PLUGIN_ID,
			})
			const b = await svc.create({
				name: "b",
				contentPluginId: IMAGE_PLUGIN_ID,
			})
			// Owned by a different plugin — must be untouched.
			const c = await svc.create({ name: "c", contentPluginId: TEXT_PLUGIN_ID })
			// Trashed resource bound to the source plugin — must be excluded.
			const d = await svc.create({
				name: "d",
				contentPluginId: IMAGE_PLUGIN_ID,
			})
			await svc.softDelete(d.id)

			// Give `a` a derived meta row so the atomic clear is observable.
			dbh.db
				.insert(resourceMeta)
				.values({
					resourceId: a.id,
					sourceMeta: JSON.stringify({ coverKind: "image" }),
					builtAt: 1,
				})
				.run()

			const result = await svc.replaceContentPlugin({
				fromPluginId: IMAGE_PLUGIN_ID,
				toPluginId: TEST_BUILTIN_ID,
				rebuild: "defer",
			})
			expect(result.affected).toBe(2)

			const pluginOf = (id: string): string | null =>
				dbh.db.select().from(resources).where(eq(resources.id, id)).get()
					?.contentPluginId ?? null
			expect(pluginOf(a.id)).toBe(TEST_BUILTIN_ID)
			expect(pluginOf(b.id)).toBe(TEST_BUILTIN_ID)
			expect(pluginOf(c.id)).toBe(TEXT_PLUGIN_ID)
			expect(pluginOf(d.id)).toBe(IMAGE_PLUGIN_ID)

			const metaRow = dbh.db
				.select()
				.from(resourceMeta)
				.where(eq(resourceMeta.resourceId, a.id))
				.get()
			expect(metaRow?.sourceMeta).toBeNull()
			expect(metaRow?.coverMeta).toBeNull()
		})

		test("replaceContentPlugin defers a rebuild (defer) or enqueues it immediately (immediate)", async () => {
			// Bound to the source plugin (no sourceMeta capability) so the
			// rebuild on the builtin target is what produces meta.
			await svc.create({ name: "a", contentPluginId: IMAGE_PLUGIN_ID })
			await svc.drainMetaQueue()
			const baseline = getMetaBuildCalls()

			// Defer runs no extra rebuild.
			await svc.replaceContentPlugin({
				fromPluginId: IMAGE_PLUGIN_ID,
				toPluginId: TEST_BUILTIN_ID,
				rebuild: "defer",
			})
			await svc.drainMetaQueue()
			expect(getMetaBuildCalls()).toBe(baseline)

			// Immediate enqueues at least one additional rebuild pass.
			await svc.create({ name: "b", contentPluginId: IMAGE_PLUGIN_ID })
			await svc.drainMetaQueue()
			const afterCreateB = getMetaBuildCalls()
			await svc.replaceContentPlugin({
				fromPluginId: IMAGE_PLUGIN_ID,
				toPluginId: TEST_BUILTIN_ID,
				rebuild: "immediate",
			})
			await svc.drainMetaQueue()
			expect(getMetaBuildCalls()).toBeGreaterThan(afterCreateB)
		})

		test("replaceContentPlugin rejects a same plugin and an unavailable target", async () => {
			await svc.create({ name: "a", contentPluginId: IMAGE_PLUGIN_ID })

			await expect(
				svc.replaceContentPlugin({
					fromPluginId: IMAGE_PLUGIN_ID,
					toPluginId: IMAGE_PLUGIN_ID,
					rebuild: "defer",
				}),
			).rejects.toMatchObject({
				code: "CONFLICT",
				kind: "resources.replace_content_plugin.same_plugin",
			})

			await expect(
				svc.replaceContentPlugin({
					fromPluginId: IMAGE_PLUGIN_ID,
					toPluginId: "99999999-9999-4999-8999-999999999999",
					rebuild: "defer",
				}),
			).rejects.toMatchObject({
				code: "VALIDATION",
				kind: "resources.replace_content_plugin.unknown_target",
			})
		})

		test("listContentPluginUsage returns distinct content plugin ids with live counts", async () => {
			await svc.create({ name: "a", contentPluginId: IMAGE_PLUGIN_ID })
			await svc.create({ name: "b", contentPluginId: IMAGE_PLUGIN_ID })
			await svc.create({ name: "c", contentPluginId: TEXT_PLUGIN_ID })
			const trashed = await svc.create({
				name: "d",
				contentPluginId: IMAGE_PLUGIN_ID,
			})
			await svc.softDelete(trashed.id)

			const usage = svc.listContentPluginUsage()
			expect(usage).toHaveLength(2)
			expect(usage).toEqual(
				expect.arrayContaining([
					{ pluginId: IMAGE_PLUGIN_ID, count: 2 },
					{ pluginId: TEXT_PLUGIN_ID, count: 1 },
				]),
			)
		})

		test("replaceContentPlugin treats a source with no resources as a no-op", async () => {
			const result = await svc.replaceContentPlugin({
				fromPluginId: IMAGE_PLUGIN_ID,
				toPluginId: TEST_BUILTIN_ID,
				rebuild: "defer",
			})
			expect(result.affected).toBe(0)
		})

		test("replaceContentPlugin migrates an orphaned (unregistered) source", async () => {
			const orphanId = "99999999-9999-4999-8999-999999999999"
			const r = await svc.create({ name: "orphan", contentPluginId: orphanId })
			const result = await svc.replaceContentPlugin({
				fromPluginId: orphanId,
				toPluginId: TEST_BUILTIN_ID,
				rebuild: "defer",
			})
			expect(result.affected).toBe(1)
			const contentPluginOf = (id: string): string | null =>
				dbh.db.select().from(resources).where(eq(resources.id, id)).get()
					?.contentPluginId ?? null
			expect(contentPluginOf(r.id)).toBe(TEST_BUILTIN_ID)
		})

		test("replaceContentPlugin rejects a disabled target", async () => {
			const custom = svcWith(registryWithDisabledPlugin())
			await expect(
				custom.replaceContentPlugin({
					fromPluginId: TEST_BUILTIN_ID,
					toPluginId: IMAGE_PLUGIN_ID,
					rebuild: "defer",
				}),
			).rejects.toMatchObject({
				code: "VALIDATION",
				kind: "resources.replace_content_plugin.unknown_target",
			})
		})

		test("replaceContentPlugin rejects a missing target", async () => {
			const custom = svcWith(registryWithMissingPlugin())
			await expect(
				custom.replaceContentPlugin({
					fromPluginId: TEST_BUILTIN_ID,
					toPluginId: IMAGE_PLUGIN_ID,
					rebuild: "defer",
				}),
			).rejects.toMatchObject({
				code: "VALIDATION",
				kind: "resources.replace_content_plugin.unknown_target",
			})
		})

		test("listContentPluginUsage excludes an empty-string content plugin id", async () => {
			await svc.create({ name: "a", contentPluginId: IMAGE_PLUGIN_ID })
			// An empty-string `content_plugin_id` is a "no plugin assigned"
			// residue, not a source to migrate away from.
			dbh.db
				.insert(resources)
				.values({
					id: "r-empty-residue",
					name: "empty",
					contentPluginId: "",
					createdAt: 1,
					updatedAt: 1,
				})
				.run()
			const usage = svc.listContentPluginUsage()
			expect(usage).toEqual([{ pluginId: IMAGE_PLUGIN_ID, count: 1 }])
		})

		test("replaceContentPlugin defers hashes: clears hashesMeta but keeps old plugin hash rows", async () => {
			const r = await svc.create({
				name: "hashes",
				contentPluginId: IMAGE_PLUGIN_ID,
			})
			dbh.db
				.insert(resourceHashes)
				.values({
					resourceId: r.id,
					pluginId: IMAGE_PLUGIN_ID,
					scope: "a.png",
					type: "sha256",
					value: "ab",
					bits: 8,
				})
				.run()
			dbh.db
				.insert(resourceMeta)
				.values({
					resourceId: r.id,
					hashesMeta: JSON.stringify({ v: 1 }),
					builtAt: 1,
				})
				.run()

			await svc.replaceContentPlugin({
				fromPluginId: IMAGE_PLUGIN_ID,
				toPluginId: TEST_BUILTIN_ID,
				rebuild: "defer",
			})

			// hashesMeta is cleared (a rebuild is now pending)…
			const meta = dbh.db
				.select()
				.from(resourceMeta)
				.where(eq(resourceMeta.resourceId, r.id))
				.get()
			expect(meta?.hashesMeta).toBeNull()
			// …but the old-plugin hash row survives until the lazy rebuild
			// replaces it (the documented deferred-rebuild contract).
			const hashes = dbh.db
				.select()
				.from(resourceHashes)
				.where(eq(resourceHashes.resourceId, r.id))
				.all()
			expect(hashes).toHaveLength(1)
			expect(hashes[0]?.pluginId).toBe(IMAGE_PLUGIN_ID)
		})

		test("replaceContentPlugin skips resources the target plugin cannot detect", async () => {
			await svc.create({ name: "plain", contentPluginId: TEST_BUILTIN_ID })
			// IMAGE_PLUGIN_ID's detector wants image files; this resource has
			// none, so it must stay on the source plugin.
			const result = await svc.replaceContentPlugin({
				fromPluginId: TEST_BUILTIN_ID,
				toPluginId: IMAGE_PLUGIN_ID,
				rebuild: "defer",
			})
			expect(result.affected).toBe(0)
			expect(result.failures).toHaveLength(1)
			expect(result.failures[0]?.reasons.length).toBeGreaterThan(0)
		})

		test("replaceContentPlugin replaces only the resources the target accepts", async () => {
			const withImage = await svc.create({
				name: "img",
				contentPluginId: TEST_BUILTIN_ID,
			})
			await seedResourceArtifact({ db: dbh, paths }, withImage.id, [
				{ name: "page.png", bytes: Buffer.alloc(0) },
			])
			const noImage = await svc.create({
				name: "txt",
				contentPluginId: TEST_BUILTIN_ID,
			})

			const result = await svc.replaceContentPlugin({
				fromPluginId: TEST_BUILTIN_ID,
				toPluginId: IMAGE_PLUGIN_ID,
				rebuild: "defer",
			})
			expect(result.affected).toBe(1)
			expect(result.failures).toHaveLength(1)
			expect(result.failures[0]?.id).toBe(noImage.id)

			const pluginOf = (id: string): string | null =>
				dbh.db.select().from(resources).where(eq(resources.id, id)).get()
					?.contentPluginId ?? null
			expect(pluginOf(withImage.id)).toBe(IMAGE_PLUGIN_ID)
			// The rejected one stays on the source plugin.
			expect(pluginOf(noImage.id)).toBe(TEST_BUILTIN_ID)
		})
	})
})

describe("resource dislike votes", () => {
	let root: string
	let dbh: DbHandles
	let paths: StoragePaths
	let nowValue: number
	let svc: ResService

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-res-dislike-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		paths = createStoragePaths({ root })
		nowValue = 1_000_000
		svc = createResourceService({
			db: dbh.db,
			paths,
			pluginHooks: createTestHooks(),
			readOnly: { current: false },
			now: () => nowValue,
		})
	})

	afterEach(async () => {
		await svc.drainMetaQueue()
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("first click adds a cancellable dislike and bumps the count", async () => {
		const r = await svc.create({ name: "a" })
		const result = await svc.addDislike(r.id)
		expect(result.action).toBe("added")
		if (result.action === "added") {
			expect(result.dislike?.cancellable).toBe(true)
		}
		const detail = await svc.detail(r.id)
		expect(detail.dislikeCount).toBe(1)
		expect(detail.dislikedRecently).toBe(true)
	})

	test("a repeat click inside the 24h window cancels the dislike", async () => {
		const r = await svc.create({ name: "a" })
		await svc.addDislike(r.id)
		nowValue += 60 * 60 * 1000
		const result = await svc.addDislike(r.id)
		expect(result.action).toBe("cancelled")
		const detail = await svc.detail(r.id)
		expect(detail.dislikeCount).toBe(0)
		expect(detail.dislikedRecently).toBe(false)
	})

	test("a click after the window expires appends a permanent dislike", async () => {
		const r = await svc.create({ name: "a" })
		await svc.addDislike(r.id)
		nowValue += 25 * 60 * 60 * 1000
		const result = await svc.addDislike(r.id)
		expect(result.action).toBe("added")
		const detail = await svc.detail(r.id)
		expect(detail.dislikeCount).toBe(2)
		expect(detail.dislikedRecently).toBe(true)
		// A further click can no longer remove the expired row, only the
		// newest in-window one.
		nowValue += 60 * 60 * 1000
		const cancel = await svc.addDislike(r.id)
		expect(cancel.action).toBe("cancelled")
		expect((await svc.detail(r.id)).dislikeCount).toBe(1)
	})

	test("listDislikes returns rows newest-first with server-computed cancellable", async () => {
		const r = await svc.create({ name: "a" })
		await svc.addDislike(r.id)
		nowValue += 25 * 60 * 60 * 1000
		await svc.addDislike(r.id)
		const dislikes = await svc.listDislikes(r.id)
		expect(dislikes.length).toBe(2)
		expect(dislikes[0]?.cancellable).toBe(true)
		expect(dislikes[1]?.cancellable).toBe(false)
	})

	test("dislikedOnly filter and disliked sort are honoured by listCards", async () => {
		const a = await svc.create({ name: "a" })
		const b = await svc.create({ name: "b" })
		const c = await svc.create({ name: "c" })
		await svc.addDislike(a.id)
		nowValue += 25 * 60 * 60 * 1000
		await svc.addDislike(a.id) // a: 2 dislikes
		await svc.addDislike(b.id) // b: 1 dislike
		const filtered = await svc.listCards({ dislikedOnly: true })
		expect(filtered.rows.map((r) => r.id).sort()).toEqual([a.id, b.id].sort())
		expect(filtered.total).toBe(2)

		const byDislikesDesc = await svc.listCards({
			sortBy: "disliked",
			order: "desc",
		})
		expect(byDislikesDesc.rows.map((r) => r.id)).toEqual([a.id, b.id, c.id])
		const byDislikesAsc = await svc.listCards({
			sortBy: "disliked",
			order: "asc",
		})
		expect(byDislikesAsc.rows.map((r) => r.id)).toEqual([c.id, b.id, a.id])
	})

	test("colIds filter restricts listCards to collection members", async () => {
		const a = await svc.create({ name: "a" })
		await svc.create({ name: "b" })
		const colId = "col-1"
		dbh.db
			.insert(resCollections)
			.values({
				id: colId,
				name: "Shelf",
				intro: "",
				color: "",
				position: 0,
				pinned: false,
				createdAt: Date.now(),
				updatedAt: Date.now(),
			})
			.run()
		dbh.db
			.insert(resCollectionItems)
			.values({
				colId,
				resId: a.id,
				position: 0,
				createdAt: Date.now(),
			})
			.run()

		const all = await svc.listCards({})
		expect(all.total).toBe(2)

		const filtered = await svc.listCards({ colIds: [colId] })
		expect(filtered.rows.map((r) => r.id)).toEqual([a.id])
		expect(filtered.total).toBe(1)

		const none = await svc.listCards({ colIds: ["col-missing"] })
		expect(none.total).toBe(0)
	})

	test("dislike on a missing resource throws NOT_FOUND", async () => {
		try {
			await svc.addDislike("nope")
			expect.unreachable("addDislike should have thrown")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			if (err instanceof DomainError) {
				expect(err.code).toBe("NOT_FOUND")
			}
		}
	})
})
