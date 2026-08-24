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
	let removeSeedSource: ((id: string) => Promise<void>) | undefined

	function registryWith(entries: readonly ReturnType<typeof entryFor>[]) {
		registry = buildRegistry(entries)
		loader = {
			getRegistry: () => registry,
			rescan: vi.fn(async () => {}),
		} as unknown as PluginLoader
		sandbox = { unloadPlugin: vi.fn() } as unknown as PluginSandbox
		prepareDisk = vi.fn(async () => {})
		removeSeedSource = vi.fn(async () => {})
		svc = createPluginService({
			db: dbh.db,
			loader,
			sandbox,
			prepareDisk,
			removeSeedSource,
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
		svc = createPluginService({ db: dbh.db, loader, sandbox })
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
		// — while the (optional) seed-source cleanup runs for packaged
		// runtimes.
		expect(removeSeedSource).toHaveBeenCalledWith(PLUGIN_ID)
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
})
