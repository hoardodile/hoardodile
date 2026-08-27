import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type {
	PluginLoader,
	PluginRegistryEntry,
	PluginSandbox,
} from "@hoardodile/host"
import { buildRegistry } from "@hoardodile/host"
import type { PluginManifestId } from "@hoardodile/sdk-types"
import { eq } from "drizzle-orm"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import { contentPlugins } from "./schema.ts"
import { createSeedRemovalsStore } from "./seed-removals.ts"
import { createPluginService, type PluginService } from "./service.ts"

const PLUGIN_ID = "11111111-1111-4111-8111-111111111111" as PluginManifestId

function manifestFor(id: PluginManifestId, name: string) {
	return {
		id,
		name,
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
	}
}

function entryFor(
	id: PluginManifestId,
	name: string,
	overrides: Partial<{
		enabled: boolean
		missing: boolean
		builtin: boolean
		dev: boolean
		priority: number
		diskPath: string | undefined
	}> = {},
): PluginRegistryEntry {
	return {
		id,
		manifest: manifestFor(id, name),
		enabled: overrides.enabled ?? true,
		priority: overrides.priority ?? 100,
		pinned: false,
		color: "",
		missing: overrides.missing ?? false,
		builtin: overrides.builtin ?? false,
		dev: overrides.dev ?? false,
		plugin: { detect: async () => ({ ok: true }) as const },
		...(overrides.diskPath !== undefined
			? { diskPath: overrides.diskPath }
			: {}),
	}
}

describe("plugin service uninstall", () => {
	let root: string
	let pluginsDir: string
	let dbh: DbHandles
	let registry: ReturnType<typeof buildRegistry>
	let loader: PluginLoader
	let sandbox: PluginSandbox
	let svc: PluginService
	let prepareDisk: (() => Promise<void>) | undefined
	let seedDirs: string[]
	let seedRemovalsFile: string

	function registryWith(
		entries: readonly ReturnType<typeof entryFor>[],
		seedRemovalsOverride?: Parameters<
			typeof createPluginService
		>[0]["seedRemovals"],
	) {
		registry = buildRegistry(entries)
		loader = {
			getRegistry: () => registry,
			rescan: vi.fn(async () => {}),
		} as unknown as PluginLoader
		sandbox = { unloadPlugin: vi.fn() } as unknown as PluginSandbox
		prepareDisk = vi.fn(async () => {})
		seedDirs = []
		seedRemovalsFile = join(root, "local", "seed-removals.json")
		svc = createPluginService({
			db: dbh.db,
			loader,
			sandbox,
			prepareDisk,
			seedDirs,
			seedRemovals:
				seedRemovalsOverride ?? createSeedRemovalsStore(seedRemovalsFile),
		})
	}

	function seedSettingsRow(id: PluginManifestId): void {
		dbh.db
			.insert(contentPlugins)
			.values({
				id,
				manifest: JSON.stringify(manifestFor(id, "Test")),
				enabled: 1,
				priority: 100,
				pinned: 0,
				color: "",
				missing: 0,
				createdAt: 1,
				updatedAt: 1,
			})
			.run()
	}

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "plugin-svc-"))
		pluginsDir = join(root, "plugins")
		mkdirSync(pluginsDir, { recursive: true })
		dbh = openDb(":memory:")
		dbh.runMigrations()
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("rejects an unknown plugin id", async () => {
		registryWith([])
		await expect(svc.uninstall(PLUGIN_ID)).rejects.toThrow("not registered")
	})

	test("syncRecords registers discovered plugins with default settings", () => {
		registryWith([
			entryFor(PLUGIN_ID, "Disk", { priority: 42 }),
			entryFor(
				"22222222-2222-4222-8222-222222222222" as PluginManifestId,
				"Builtin",
				{ builtin: true },
			),
			entryFor(
				"33333333-3333-4333-8333-333333333333" as PluginManifestId,
				"Dev",
				{ dev: true },
			),
		])
		svc.syncRecords()
		const row = dbh.db
			.select()
			.from(contentPlugins)
			.where(eq(contentPlugins.id, PLUGIN_ID))
			.get()
		expect(row).toBeDefined()
		expect(row?.priority).toBe(42)
		expect(row?.missing).toBe(0)
		expect(row?.enabled).toBe(1)
		expect(row?.pinned).toBe(1)
		expect(JSON.parse(row?.manifest ?? "{}")).toEqual(
			manifestFor(PLUGIN_ID, "Disk"),
		)
		// Builtin and dev plugins are not recorded.
		const all = dbh.db.select().from(contentPlugins).all()
		expect(all.map((r) => r.id).sort()).toEqual([PLUGIN_ID])
	})

	test("syncRecords leaves existing rows untouched", () => {
		seedSettingsRow(PLUGIN_ID)
		registryWith([entryFor(PLUGIN_ID, "Disk", { priority: 99 })])
		svc.syncRecords()
		const row = dbh.db
			.select()
			.from(contentPlugins)
			.where(eq(contentPlugins.id, PLUGIN_ID))
			.get()
		expect(row?.priority).toBe(100)
		expect(JSON.parse(row?.manifest ?? "{}").name).toBe("Test")
	})

	test("rescan records discovered plugins after reloading the registry", async () => {
		registryWith([])
		await svc.rescan()
		expect(loader.rescan).toHaveBeenCalled()
	})

	test("uninstalled plugins are not re-registered by a later rescan", async () => {
		const diskPath = join(pluginsDir, PLUGIN_ID)
		mkdirSync(diskPath, { recursive: true })
		writeFileSync(join(diskPath, "manifest.json"), "{}")
		seedSettingsRow(PLUGIN_ID)
		registryWith([entryFor(PLUGIN_ID, "Disk", { diskPath })])
		await svc.uninstall(PLUGIN_ID)
		// A real rescan rebuilds the registry from disk — the uninstalled
		// plugin's directory is gone, so it no longer appears.
		loader = {
			getRegistry: () => buildRegistry([]),
			rescan: vi.fn(async () => {}),
		} as unknown as PluginLoader
		svc = createPluginService({
			db: dbh.db,
			loader,
			sandbox,
			seedDirs,
			seedRemovals: createSeedRemovalsStore(seedRemovalsFile),
		})
		await svc.rescan()
		const row = dbh.db
			.select()
			.from(contentPlugins)
			.where(eq(contentPlugins.id, PLUGIN_ID))
			.get()
		expect(row).toBeUndefined()
	})

	test("rejects the builtin plugin", async () => {
		registryWith([entryFor(PLUGIN_ID, "Builtin", { builtin: true })])
		await expect(svc.uninstall(PLUGIN_ID)).rejects.toThrow("builtin")
		expect(sandbox.unloadPlugin).not.toHaveBeenCalled()
	})

	test("rejects a dev plugin", async () => {
		registryWith([entryFor(PLUGIN_ID, "Dev", { dev: true })])
		await expect(svc.uninstall(PLUGIN_ID)).rejects.toThrow("Dev plugins")
	})

	test("deletes the disk directory, settings row, and registry entry", async () => {
		const diskPath = join(pluginsDir, PLUGIN_ID)
		mkdirSync(diskPath, { recursive: true })
		writeFileSync(join(diskPath, "manifest.json"), "{}")
		seedSettingsRow(PLUGIN_ID)
		registryWith([entryFor(PLUGIN_ID, "Disk", { diskPath })])

		await svc.uninstall(PLUGIN_ID)

		expect(existsSync(diskPath)).toBe(false)
		const row = dbh.db
			.select()
			.from(contentPlugins)
			.where(eq(contentPlugins.id, PLUGIN_ID))
			.get()
		expect(row).toBeUndefined()
		expect(sandbox.unloadPlugin).toHaveBeenCalledWith(PLUGIN_ID)
		expect(loader.rescan).toHaveBeenCalled()
		// The removal stays removed for the session — no immediate re-seed
		// — and the removal marker records it so boot-time seeding skips
		// the (untouched) bundled original on the next restart.
		expect(
			createSeedRemovalsStore(seedRemovalsFile).read().has(PLUGIN_ID),
		).toBe(true)
		expect(prepareDisk).not.toHaveBeenCalled()
	})

	test("a missing plugin is uninstalled without touching the filesystem", async () => {
		seedSettingsRow(PLUGIN_ID)
		registryWith([entryFor(PLUGIN_ID, "Gone", { missing: true })])
		const before = join(pluginsDir, PLUGIN_ID)
		writeFileSync(before, "x")
		try {
			await svc.uninstall(PLUGIN_ID)
			// The stub file is unrelated to the plugin dir — untouched.
			expect(existsSync(before)).toBe(true)
		} finally {
			rmSync(before, { force: true })
		}
		const row = dbh.db
			.select()
			.from(contentPlugins)
			.where(eq(contentPlugins.id, PLUGIN_ID))
			.get()
		expect(row).toBeUndefined()
	})

	test("uninstall aborts when the removal marker cannot be persisted", async () => {
		const diskPath = join(pluginsDir, PLUGIN_ID)
		mkdirSync(diskPath, { recursive: true })
		writeFileSync(join(diskPath, "manifest.json"), "{}")
		seedSettingsRow(PLUGIN_ID)
		registryWith([entryFor(PLUGIN_ID, "Disk", { diskPath })], {
			read: () => new Set(),
			add: () => {
				throw new Error("disk full")
			},
			remove: () => {},
		})

		await expect(svc.uninstall(PLUGIN_ID)).rejects.toThrow("disk full")

		// A failed marker write aborts the uninstall: the settings row stays
		// and no worker is freed — the plugin remains registered (the user
		// can retry, and a restart cannot silently resurrect it).
		const row = dbh.db
			.select()
			.from(contentPlugins)
			.where(eq(contentPlugins.id, PLUGIN_ID))
			.get()
		expect(row).toBeDefined()
		expect(sandbox.unloadPlugin).not.toHaveBeenCalled()
		expect(loader.rescan).not.toHaveBeenCalled()
	})
})

describe("plugin service seed plugins", () => {
	let root: string
	let dbh: DbHandles
	let registry: ReturnType<typeof buildRegistry>
	let loader: PluginLoader
	let sandbox: PluginSandbox
	let svc: PluginService
	let prepareDisk: (() => Promise<void>) | undefined
	let seedDirs: string[]
	let seedRemovalsFile: string

	function build(dirs: readonly string[]) {
		loader = {
			getRegistry: () => registry,
			rescan: vi.fn(async () => {}),
		} as unknown as PluginLoader
		sandbox = { unloadPlugin: vi.fn() } as unknown as PluginSandbox
		prepareDisk = vi.fn(async () => {})
		seedDirs = [...dirs]
		seedRemovalsFile = join(root, "local", "seed-removals.json")
		svc = createPluginService({
			db: dbh.db,
			loader,
			sandbox,
			prepareDisk,
			seedDirs,
			seedRemovals: createSeedRemovalsStore(seedRemovalsFile),
		})
	}

	function writeSeedDir(name: string, id: PluginManifestId) {
		const dir = join(root, "seeds", name)
		mkdirSync(dir, { recursive: true })
		writeFileSync(
			join(dir, "manifest.json"),
			// The bundled manifest must satisfy the contract schema (a
			// non-empty description), unlike the lenient registry fixtures.
			JSON.stringify({ ...manifestFor(id, name), description: `${name} seed` }),
		)
		writeFileSync(join(dir, "main.js"), "export default {}\n")
		return dir
	}

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "plugin-seeds-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("listSeedPlugins annotates installed, removed and restorable", () => {
		const installedDir = writeSeedDir("installed", PLUGIN_ID)
		const removedId = "22222222-2222-4222-8222-222222222222" as PluginManifestId
		const removedDir = writeSeedDir("removed", removedId)
		const junkDir = writeSeedDir(
			"junk",
			"44444444-4444-4444-8444-444444444444" as PluginManifestId,
		)
		rmSync(join(junkDir, "manifest.json"))
		build([installedDir, removedDir, junkDir])
		registry = buildRegistry([entryFor(PLUGIN_ID, "installed")])
		createSeedRemovalsStore(seedRemovalsFile).add(removedId)

		const rows = svc.listSeedPlugins()

		expect(rows).toHaveLength(2)
		const installed = rows.find((r) => r.id === PLUGIN_ID)
		expect(installed).toMatchObject({
			id: PLUGIN_ID,
			installed: true,
			installedVersion: "1.0.0",
			removed: false,
			restorable: false,
		})
		const removed = rows.find((r) => r.id === removedId)
		expect(removed).toMatchObject({
			id: removedId,
			installed: false,
			removed: true,
			restorable: true,
		})
	})

	test("restoreSeedPlugin clears the marker and rescans (offline restore)", async () => {
		const dir = writeSeedDir("gallery", PLUGIN_ID)
		build([dir])
		registry = buildRegistry([])
		createSeedRemovalsStore(seedRemovalsFile).add(PLUGIN_ID)

		await svc.restoreSeedPlugin(PLUGIN_ID)

		expect(
			createSeedRemovalsStore(seedRemovalsFile).read().has(PLUGIN_ID),
		).toBe(false)
		expect(loader.rescan).toHaveBeenCalled()
		// The reseed channel (prepareDisk → seedPlugins) re-copies the tree.
		expect(prepareDisk).toHaveBeenCalled()
	})

	test("restoreSeedPlugin rejects an unknown seed id", async () => {
		build([writeSeedDir("gallery", PLUGIN_ID)])
		registry = buildRegistry([])
		await expect(
			svc.restoreSeedPlugin(
				"33333333-3333-4333-8333-333333333333" as PluginManifestId,
			),
		).rejects.toThrow("bundled source")
	})

	test("restoreSeedPlugin rejects an already-installed plugin", async () => {
		build([writeSeedDir("gallery", PLUGIN_ID)])
		registry = buildRegistry([entryFor(PLUGIN_ID, "gallery")])
		await expect(svc.restoreSeedPlugin(PLUGIN_ID)).rejects.toThrow(
			"already installed",
		)
	})
})

describe("plugin service marketplace source", () => {
	let root: string
	let dbh: DbHandles
	let registry: ReturnType<typeof buildRegistry>
	let loader: PluginLoader
	let sandbox: PluginSandbox
	let svc: PluginService

	function build() {
		loader = {
			getRegistry: () => registry,
			rescan: vi.fn(async () => {}),
		} as unknown as PluginLoader
		sandbox = { unloadPlugin: vi.fn() } as unknown as PluginSandbox
		svc = createPluginService({
			db: dbh.db,
			loader,
			sandbox,
			seedDirs: [],
			seedRemovals: createSeedRemovalsStore(
				join(root, "local", "seed-removals.json"),
			),
		})
	}

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "plugin-src-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("records the source repo on an existing settings row", () => {
		dbh.db
			.insert(contentPlugins)
			.values({
				id: PLUGIN_ID,
				manifest: JSON.stringify(manifestFor(PLUGIN_ID, "Test")),
				enabled: 1,
				priority: 100,
				pinned: 0,
				color: "",
				missing: 0,
				createdAt: 1,
				updatedAt: 1,
			})
			.run()
		registry = buildRegistry([entryFor(PLUGIN_ID, "Disk")])
		build()

		svc.setMarketplaceSource(PLUGIN_ID, "me/cat-viewer")

		const row = dbh.db
			.select()
			.from(contentPlugins)
			.where(eq(contentPlugins.id, PLUGIN_ID))
			.get()
		expect(row?.sourceRepo).toBe("me/cat-viewer")
		expect(svc.listMarketplaceSources()).toEqual([
			{ id: PLUGIN_ID, repo: "me/cat-viewer" },
		])
	})

	test("seeds a missing settings row before recording the source", () => {
		registry = buildRegistry([entryFor(PLUGIN_ID, "Disk")])
		build()

		svc.setMarketplaceSource(PLUGIN_ID, "me/cat-viewer")

		const row = dbh.db
			.select()
			.from(contentPlugins)
			.where(eq(contentPlugins.id, PLUGIN_ID))
			.get()
		expect(row?.sourceRepo).toBe("me/cat-viewer")
		expect(JSON.parse(row?.manifest ?? "{}").name).toBe("Disk")
	})

	test("throws for an unregistered plugin — no row is invented", () => {
		registry = buildRegistry([])
		build()
		expect(() => svc.setMarketplaceSource(PLUGIN_ID, "me/cat-viewer")).toThrow(
			"not registered",
		)
		expect(svc.listMarketplaceSources()).toEqual([])
	})

	test("uninstall drops the source along with the settings row", async () => {
		const diskPath = join(root, "plugins", PLUGIN_ID)
		mkdirSync(diskPath, { recursive: true })
		writeFileSync(join(diskPath, "manifest.json"), "{}")
		dbh.db
			.insert(contentPlugins)
			.values({
				id: PLUGIN_ID,
				manifest: JSON.stringify(manifestFor(PLUGIN_ID, "Test")),
				enabled: 1,
				priority: 100,
				pinned: 0,
				color: "",
				missing: 0,
				createdAt: 1,
				updatedAt: 1,
				sourceRepo: "me/cat-viewer",
			})
			.run()
		registry = buildRegistry([entryFor(PLUGIN_ID, "Disk", { diskPath })])
		build()

		await svc.uninstall(PLUGIN_ID)

		expect(svc.listMarketplaceSources()).toEqual([])
	})
})
