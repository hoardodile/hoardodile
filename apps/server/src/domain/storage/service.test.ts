import {
	mkdirSync,
	mkdtempSync,
	rmSync,
	statSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resourceMeta, resources } from "src/domain/res/schema.ts"
import { openDb } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createStorageService } from "./service.ts"

const PLUGIN_A = "11111111-1111-4111-8111-111111111111"
const PLUGIN_B = "22222222-2222-4222-8222-222222222222"

describe("storage service", () => {
	let root: string
	let paths: ReturnType<typeof createStoragePaths>
	let dbh: ReturnType<typeof openDb>

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-storage-"))
		paths = createStoragePaths({ root })
		dbh = openDb(paths.runtimeDb())
		dbh.runMigrations()
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	function insertResource(
		id: string,
		pluginId: string,
		sizeBytes: number,
	): void {
		dbh.db
			.insert(resources)
			.values({
				id,
				name: `res-${id}`,
				contentPluginId: pluginId,
				createdAt: 1,
				updatedAt: 1,
			})
			.run()
		dbh.db
			.insert(resourceMeta)
			.values({
				resourceId: id,
				fileStats: JSON.stringify({ sizeBytes, count: 1 }),
				builtAt: 1,
			})
			.run()
	}

	function createService(pluginNames?: Map<string, string>) {
		return createStorageService({
			db: dbh.db,
			paths,
			pluginNames,
		})
	}

	test("aggregates live resources per plugin from metadata", async () => {
		insertResource("r1", PLUGIN_A, 1000)
		insertResource("r2", PLUGIN_A, 2500)
		insertResource("r3", PLUGIN_B, 400)
		// Trashed resources are excluded from the breakdown.
		dbh.db
			.insert(resources)
			.values({
				id: "r4",
				name: "trashed",
				contentPluginId: PLUGIN_A,
				createdAt: 1,
				updatedAt: 1,
				deletedAt: 1,
			})
			.run()

		const overview = await createService(
			new Map([[PLUGIN_A, "Plugin A"]]),
		).getOverview()

		expect(overview.resources.byPlugin).toHaveLength(2)
		expect(overview.resources.byPlugin[0]).toMatchObject({
			pluginId: PLUGIN_A,
			name: "Plugin A",
			sizeBytes: 3500,
			resourceCount: 2,
		})
		expect(overview.resources.byPlugin[1]).toMatchObject({
			pluginId: PLUGIN_B,
			sizeBytes: 400,
			resourceCount: 1,
		})
		// Largest plugin first.
		expect(overview.resources.byPlugin[0]?.pluginId).toBe(PLUGIN_A)
		expect(overview.resources.totalBytes).toBe(3900)
	})

	test("tolerates missing or malformed fileStats", async () => {
		insertResource("r1", PLUGIN_A, 1000)
		dbh.db
			.insert(resources)
			.values({
				id: "r2",
				name: "malformed-meta",
				contentPluginId: PLUGIN_A,
				createdAt: 1,
				updatedAt: 1,
			})
			.run()
		dbh.db
			.insert(resourceMeta)
			.values({
				resourceId: "r2",
				fileStats: "not-json",
				builtAt: 1,
			})
			.run()

		const overview = await createService().getOverview()
		expect(overview.resources.totalBytes).toBe(1000)
		expect(overview.resources.byPlugin[0]?.resourceCount).toBe(2)
		// The malformed row has no usable size — counted as unattributed.
		expect(overview.resources.unattributedCount).toBe(1)
		expect(overview.resources.unattributedBytes).toBe(0)
	})

	test("attributes disk bytes to resources missing fileStats", async () => {
		insertResource("r1", PLUGIN_A, 1000)
		// r2 has no fileStats metadata at all.
		dbh.db
			.insert(resources)
			.values({
				id: "r2",
				name: "no-meta",
				contentPluginId: PLUGIN_A,
				createdAt: 1,
				updatedAt: 1,
			})
			.run()

		// Both resource folders exist on disk; only r1's bytes are
		// covered by the recorded metadata (r1's archive matches its
		// recorded size, r2 has no metadata at all).
		mkdirSync(paths.atVersion(1).resource("r1"), { recursive: true })
		writeFileSync(
			join(paths.atVersion(1).resource("r1"), "a.bin"),
			"a".repeat(1000),
		)
		mkdirSync(paths.atVersion(1).resource("r2"), { recursive: true })
		writeFileSync(
			join(paths.atVersion(1).resource("r2"), "a.bin"),
			"b".repeat(900),
		)

		const overview = await createService().getOverview()
		expect(overview.resources.totalBytes).toBe(1000)
		expect(overview.resources.byPlugin[0]?.sizeBytes).toBe(1000)
		expect(overview.resources.unattributedCount).toBe(1)
		expect(overview.resources.unattributedBytes).toBe(900)
		// The unattributed bytes stay accounted inside the total.
		expect(
			overview.databaseBytes +
				overview.cacheBytes +
				overview.trashBytes +
				overview.archivedBytes +
				overview.backupBytes +
				overview.resources.totalBytes +
				overview.resources.unattributedBytes +
				overview.otherBytes,
		).toBe(overview.usedBytes)
	})

	test("clamps unattributed bytes when metadata exceeds the latest tree", async () => {
		insertResource("r1", PLUGIN_A, 10_000)
		mkdirSync(paths.atVersion(1).resource("r1"), { recursive: true })
		writeFileSync(
			join(paths.atVersion(1).resource("r1"), "a.bin"),
			"a".repeat(100),
		)

		const overview = await createService().getOverview()
		expect(overview.resources.unattributedCount).toBe(0)
		expect(overview.resources.unattributedBytes).toBe(0)
	})

	test("breaks down database, cache, trash and backup sizes", async () => {
		const liveSize = statSync(paths.runtimeDb()).size
		expect(liveSize).toBeGreaterThan(0)

		// Derived trees: cache, trash, upload staging.
		mkdirSync(paths.local.cache(), { recursive: true })
		writeFileSync(join(paths.local.cache(), "thumb.webp"), "x".repeat(100))
		mkdirSync(paths.local.trash(), { recursive: true })
		writeFileSync(join(paths.local.trash(), "res-1"), "y".repeat(200))
		mkdirSync(paths.local.uploadStagingRoot(), { recursive: true })
		mkdirSync(join(paths.local.uploadStagingRoot(), "staging"), {
			recursive: true,
		})
		writeFileSync(
			join(paths.local.uploadStagingRoot(), "staging", "file"),
			"z".repeat(50),
		)

		const repository = join(root, "backups", "local", "data")
		mkdirSync(repository, { recursive: true })
		writeFileSync(join(repository, "pack"), "b".repeat(300))

		const overview = await createService().getOverview()

		expect(overview.databaseBytes).toBeGreaterThanOrEqual(liveSize)
		expect(overview.cacheBytes).toBeGreaterThanOrEqual(150)
		expect(overview.trashBytes).toBe(200)
		expect(overview.backupBytes).toBe(300)
		expect(overview.usedBytes).toBeGreaterThan(0)
		expect(overview.lowSpace).toBe(false)
		// The categories never exceed the recursive total.
		const accounted =
			overview.databaseBytes +
			overview.cacheBytes +
			overview.trashBytes +
			overview.archivedBytes +
			overview.backupBytes +
			overview.resources.totalBytes
		expect(accounted + overview.otherBytes).toBeLessThanOrEqual(
			overview.usedBytes,
		)
		expect(overview.otherBytes).toBeGreaterThanOrEqual(0)
	})

	test("counts archived version copies separately", async () => {
		// Freeze a version with a resource folder, then advance to version 2.
		mkdirSync(join(paths.atVersion(1).resources(), "r1"), {
			recursive: true,
		})
		writeFileSync(
			join(paths.atVersion(1).resources(), "r1", "a.bin"),
			"a".repeat(300),
		)
		mkdirSync(join(paths.atVersion(1).characters(), "c1"), {
			recursive: true,
		})
		writeFileSync(join(paths.atVersion(1).characters(), "c1", "a.txt"), "b")
		mkdirSync(
			join(
				paths.atVersion(1).plugins(),
				"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
			),
			{ recursive: true },
		)
		writeFileSync(
			join(
				paths.atVersion(1).plugins(),
				"aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
				"main.js",
			),
			"p".repeat(50),
		)
		mkdirSync(join(root, "versions", "2"), { recursive: true })
		const v2Paths = createStoragePaths({ root, latestVersion: 2 })

		const overview = await createStorageService({
			db: dbh.db,
			paths: v2Paths,
		}).getOverview()

		expect(overview.archivedBytes).toBeGreaterThanOrEqual(351)
		// The current version's folders are not "archived".
		const latest = await createStorageService({
			db: dbh.db,
			paths: createStoragePaths({ root, latestVersion: 1 }),
		}).getOverview()
		expect(latest.archivedBytes).toBe(0)
	})

	test("flags low space against the configured threshold", async () => {
		const svc = createService()
		svc.getOverview()
		const low = await createStorageService({
			db: dbh.db,
			paths,
			lowSpaceThresholdBytes: Number.MAX_SAFE_INTEGER,
		}).getOverview()
		expect(low.lowSpace).toBe(true)
	})

	test("reports volume stats when statfs succeeds", async () => {
		const overview = await createService().getOverview()
		expect(overview.volume).not.toBeNull()
		if (overview.volume !== null) {
			expect(overview.volume.totalBytes).toBeGreaterThan(0)
			expect(overview.volume.freeBytes).toBeGreaterThanOrEqual(0)
		}
	})

	test("caches the overview within the TTL window", async () => {
		const svc = createService()
		const first = await svc.getOverview()
		// A write right after the scan must not move the cached numbers.
		mkdirSync(paths.local.cache(), { recursive: true })
		writeFileSync(join(paths.local.cache(), "new-file"), "z".repeat(500))
		const second = await svc.getOverview()
		expect(second.usedBytes).toBe(first.usedBytes)
		expect(second.cacheBytes).toBe(first.cacheBytes)
	})
})
