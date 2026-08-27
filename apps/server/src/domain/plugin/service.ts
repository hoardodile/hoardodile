import { readFileSync, statSync } from "node:fs"
import { join } from "node:path"
import type {
	PluginLoader,
	PluginRegistry,
	PluginRegistryEntry,
	PluginSandbox,
} from "@hoardodile/host"
import type { PluginManifest, PluginManifestId } from "@hoardodile/sdk-types"
import type { PluginCapabilityKey } from "@hoardodile/sdk-types/plugin-capabilities"
import { pluginManifest as pluginManifestSchema } from "@hoardodile/sdk-types/schema"
import { invalid } from "@hoardodile/shared"
import { eq, isNotNull } from "drizzle-orm"
import type { SqliteDb } from "src/infra/db/connection.ts"
import { contentPlugins } from "./schema.ts"
import type { SeedRemovalsStore } from "./seed-removals.ts"

export type PluginSettingsRow = {
	readonly id: PluginManifestId
	readonly manifest: PluginManifest
	readonly enabled: boolean
	readonly priority: number
	readonly pinned: boolean
	readonly color: string
	readonly missing: boolean
	readonly builtin: boolean
	readonly dev: boolean
	/**
	 * Fingerprint of the plugin's client assets (its index.html mtime).
	 * Changes on every rebuild/reinstall, so the web client can hard-cache
	 * plugin assets under a `?v=` URL and only fetch anew when this moves.
	 */
	readonly assetVersion?: string
}

export type PluginServiceDeps = {
	readonly db: SqliteDb
	readonly loader: PluginLoader
	readonly sandbox: PluginSandbox
	/**
	 * True when the server is viewing a past archive version. The DB is a
	 * read-only clone then, so {@link PluginService.syncRecords} must not
	 * write settings rows at boot.
	 */
	readonly readOnly?: boolean
	/**
	 * Seed the latest version's plugin directory. Called before every
	 * {@link PluginService.rescan} (except the one at the end of
	 * uninstall — a removal must stay removed for the session; the seed
	 * env re-imports seeded plugins on the next restart only).
	 */
	readonly prepareDisk?: () => Promise<void>
	/**
	 * Delete the installed plugin directory for this id. Injected so the
	 * call site can wrap the write in `writeVersioned`. When omitted,
	 * uninstall falls back to removing the registry entry's `diskPath`.
	 */
	readonly removeInstalledDir?: (id: PluginManifestId) => Promise<void>
	/**
	 * Bundled (seed) plugin directories, each a plugin dir with
	 * `manifest.json` at its root. The seed channel: what ships with the
	 * app (desktop) or an admin mounts (plain server). Drives the
	 * plugins settings page's "bundled plugins" section and the restore
	 * action.
	 */
	readonly seedDirs: readonly string[]
	/**
	 * Persistent marker of deliberately-uninstalled seeds. `uninstall`
	 * records the id here so boot-time seeding skips it — the bundled
	 * original is never deleted; the user restores it from the plugins
	 * settings page.
	 */
	readonly seedRemovals: SeedRemovalsStore
}

/**
 * One bundled (seed) plugin, as the plugins settings page's bundled
 * section reads it: the bundled manifest (display truth) plus this
 * host's relationship to it. `installed` reflects the live registry;
 * `removed` the deliberate-removal marker; `restorable` is what gates
 * the offline restore action.
 */
export type SeedPluginInfo = {
	readonly id: PluginManifestId
	readonly manifest: PluginManifest
	readonly installed: boolean
	readonly installedVersion?: string
	readonly removed: boolean
	readonly restorable: boolean
}

export type PluginService = {
	listAll(): PluginSettingsRow[]
	/**
	 * Client-asset fingerprint of a single plugin (its index.html mtime),
	 * same value {@link listAll} reports per row. `undefined` when the
	 * plugin is unknown or has no on-disk index.html.
	 */
	getAssetVersion(id: PluginManifestId): string | undefined
	/**
	 * Whether the current registry entry grants a capability (O(1) lookup,
	 * live after rescans). The single source behind per-permission
	 * decisions (e.g. asset-token issuance).
	 */
	supportsCapability(
		id: PluginManifestId,
		capability: PluginCapabilityKey,
	): boolean
	update(
		id: PluginManifestId,
		settings: {
			enabled?: boolean
			priority?: number
			pinned?: boolean
			color?: string
		},
	): void
	reorder(ids: readonly PluginManifestId[]): void
	rescan(): Promise<void>
	/**
	 * Register every plugin currently on disk (non-builtin, non-dev) in
	 * the settings table. Called at startup and after every rescan so any
	 * plugin the system has seen leaves a record behind — removing it from
	 * disk later surfaces it in the missing list instead of rendering
	 * bound resources as unknown.
	 */
	syncRecords(): void
	/**
	 * Permanently remove a non-builtin, non-dev plugin: deletes its disk
	 * directory (when present), drops its settings row, frees its worker,
	 * and rescans the registry. Resources bound to it are left untouched —
	 * read paths fall back to the builtin plugin until it is reinstalled.
	 *
	 * A seed (bundled) plugin additionally gets its id recorded in the
	 * removal marker: the bundled original is never deleted, and boot-time
	 * seeding skips it until the user restores it from the plugins
	 * settings page's bundled-plugins section.
	 * @throws when the plugin is unknown, builtin, or a dev plugin.
	 */
	uninstall(id: PluginManifestId): Promise<void>
	/**
	 * The bundled (seed) plugins of this host: one row per seed dir with a
	 * parsable manifest, annotated with installed/removed/restorable
	 * state. Backs the plugins settings page's bundled-plugins section.
	 */
	listSeedPlugins(): SeedPluginInfo[]
	/**
	 * Record the normalized marketplace repo a plugin was installed from.
	 * The update source remembered across registry switches: the
	 * marketplace snapshot merges installed plugins whose source repo is
	 * no longer listed by the current registry, so their updates stay
	 * detectable. A no-op for a plugin installed outside the marketplace
	 * (the column simply stays `null`).
	 */
	setMarketplaceSource(id: PluginManifestId, repo: string): void
	/**
	 * Installed plugins with a recorded marketplace source repo — id →
	 * normalized `owner/repo`. The marketplace reads this to merge
	 * origin-repo entries into its snapshot.
	 */
	listMarketplaceSources(): readonly {
		readonly id: PluginManifestId
		readonly repo: string
	}[]
	/**
	 * Restore a deliberately-uninstalled bundled plugin from its bundled
	 * original — fully offline: clear the removal marker, then rescan
	 * (the boot seeding channel re-copies the tree and registers it).
	 * @throws when the plugin is not a bundled plugin (`plugin.seed_source_missing`)
	 *   or already installed (`plugin.seed_already_installed`).
	 */
	restoreSeedPlugin(id: PluginManifestId): Promise<void>
}

export function createPluginService(deps: PluginServiceDeps): PluginService {
	const { db, loader, sandbox, seedDirs, seedRemovals } = deps
	// Asset fingerprints are per-registry: loadAll/rescan replace the
	// registry object, so this cache can never serve a fingerprint for a
	// reloaded plugin's old disk state, and listAll stops paying one
	// statSync per plugin per request.
	const assetVersionCache = new WeakMap<
		PluginRegistry,
		Map<string, string | undefined>
	>()

	function assetVersionsOf(
		registry: PluginRegistry,
	): Map<string, string | undefined> {
		let versions = assetVersionCache.get(registry)
		if (versions === undefined) {
			versions = new Map()
			for (const entry of registry.getAll()) {
				versions.set(entry.id, assetVersionOf(entry.diskPath))
			}
			assetVersionCache.set(registry, versions)
		}
		return versions
	}

	function listAll(): PluginSettingsRow[] {
		const registry = loader.getRegistry()
		const versions = assetVersionsOf(registry)
		return registry.getAll().map((entry) => ({
			id: entry.id,
			manifest: entry.manifest,
			enabled: entry.enabled,
			priority: entry.priority,
			pinned: entry.pinned,
			color: entry.color,
			missing: entry.missing,
			builtin: entry.builtin,
			dev: entry.dev,
			assetVersion: versions.get(entry.id),
		}))
	}

	function assetVersionOf(diskPath: string | undefined): string | undefined {
		if (diskPath === undefined) return undefined
		const st = statSync(join(diskPath, "index.html"), {
			throwIfNoEntry: false,
		})
		return st !== undefined ? String(st.mtimeMs) : undefined
	}

	function getAssetVersion(id: PluginManifestId): string | undefined {
		const registry = loader.getRegistry()
		return assetVersionsOf(registry).get(id)
	}

	function supportsCapability(
		id: PluginManifestId,
		capability: PluginCapabilityKey,
	): boolean {
		return (
			loader.getRegistry().getById(id)?.manifest.permissions[capability] ===
			true
		)
	}

	/**
	 * Insert the settings row for a plugin that has no record yet. An
	 * unconfigured plugin is enabled and pinned by default; every other
	 * field falls back to the registry entry's current value.
	 */
	function insertSettingsRow(
		entry: PluginRegistryEntry,
		overrides: {
			enabled?: boolean
			priority?: number
			pinned?: boolean
			color?: string
		},
	): void {
		const now = Date.now()
		db.insert(contentPlugins)
			.values({
				id: entry.id,
				manifest: JSON.stringify(entry.manifest),
				enabled: intBool(overrides.enabled ?? true),
				priority: overrides.priority ?? entry.priority,
				pinned: intBool(overrides.pinned ?? true),
				color: overrides.color ?? entry.color,
				missing: 0,
				createdAt: now,
				updatedAt: now,
			})
			.run()
	}

	function update(
		id: PluginManifestId,
		settings: {
			enabled?: boolean
			priority?: number
			pinned?: boolean
			color?: string
		},
	): void {
		const registry = loader.getRegistry()
		const entry = registry.getById(id)
		if (entry === undefined) return
		if (entry.builtin && settings.enabled === false) {
			throw new Error("Builtin plugin cannot be disabled")
		}

		const now = Date.now()
		const existing = db
			.select()
			.from(contentPlugins)
			.where(eq(contentPlugins.id, id))
			.get()

		if (existing === undefined) {
			insertSettingsRow(entry, settings)
		} else {
			const next: Record<string, number | string> = { updatedAt: now }
			if (settings.enabled !== undefined)
				next.enabled = intBool(settings.enabled)
			if (settings.priority !== undefined) next.priority = settings.priority
			if (settings.pinned !== undefined) next.pinned = intBool(settings.pinned)
			if (settings.color !== undefined) next.color = settings.color
			db.update(contentPlugins).set(next).where(eq(contentPlugins.id, id)).run()
		}

		registry.updateEntry(id, {
			enabled: settings.enabled,
			priority: settings.priority,
			pinned: settings.pinned,
			color: settings.color,
		})

		if (settings.enabled === false) {
			// Free the disabled plugin's worker. The sandboxed definition
			// stays in the registry: hooks of disabled plugins keep serving
			// resources already bound to them, and lazily respawn a worker
			// on the next invocation.
			sandbox.unloadPlugin(id)
		}
	}

	function reorder(ids: readonly PluginManifestId[]): void {
		const registry = loader.getRegistry()
		const allEntries = registry.getAll()
		const nonBuiltinEntries = allEntries.filter((e) => !e.builtin)
		const nonBuiltinIds = new Set(nonBuiltinEntries.map((e) => e.id))

		if (ids.length !== nonBuiltinEntries.length) {
			throw new Error(
				`Expected ${nonBuiltinEntries.length} non-builtin plugin ids, got ${ids.length}`,
			)
		}
		for (const id of ids) {
			if (!nonBuiltinIds.has(id)) {
				throw new Error(`Plugin ${id} is not a non-builtin plugin`)
			}
		}

		const now = Date.now()
		for (let i = 0; i < ids.length; i++) {
			const id = ids[i]
			if (id === undefined) continue
			const priority = (i + 1) * 100
			const entry = registry.getById(id)
			if (entry === undefined) continue
			if (entry.priority === priority) continue

			const existing = db
				.select()
				.from(contentPlugins)
				.where(eq(contentPlugins.id, id))
				.get()
			if (existing !== undefined) {
				db.update(contentPlugins)
					.set({ priority, updatedAt: now })
					.where(eq(contentPlugins.id, id))
					.run()
			}
			registry.updateEntry(id, { priority })
		}
	}

	async function rescan(): Promise<void> {
		await deps.prepareDisk?.()
		await loader.rescan()
		syncRecords()
	}

	/**
	 * Register every plugin currently on disk (non-builtin, non-dev) in
	 * the settings table. Discovery itself never writes the DB — rows were
	 * previously created only when the user changed a plugin's settings —
	 * so a plugin that was bound to resources but never configured left no
	 * record and became a "phantom" once its directory disappeared. With
	 * this, any plugin the system has seen is recorded, and its removal
	 * shows up in the missing list instead of rendering resources as
	 * unknown. Existing rows are left untouched (user configuration wins).
	 */
	function syncRecords(): void {
		if (deps.readOnly === true) return
		for (const entry of loader.getRegistry().getAll()) {
			if (entry.builtin || entry.dev) continue
			const existing = db
				.select()
				.from(contentPlugins)
				.where(eq(contentPlugins.id, entry.id))
				.get()
			if (existing !== undefined) continue
			insertSettingsRow(entry, {})
		}
	}

	async function uninstall(id: PluginManifestId): Promise<void> {
		const registry = loader.getRegistry()
		const entry = registry.getById(id)
		if (entry === undefined) {
			throw new Error(`Plugin ${id} is not registered`)
		}
		if (entry.builtin) {
			throw new Error("The builtin plugin cannot be uninstalled")
		}
		if (entry.dev) {
			throw new Error(
				"Dev plugins cannot be uninstalled — remove them from DEV_PLUGIN_PATHS",
			)
		}

		// Remove the on-disk plugin directory first (missing plugins have
		// none). A failure here aborts the uninstall and keeps the settings
		// row, so a half-removed plugin can never orphan its records.
		if (!entry.missing) {
			if (deps.removeInstalledDir !== undefined) {
				await deps.removeInstalledDir(id)
			} else if (entry.diskPath !== undefined) {
				const { rm } = await import("node:fs/promises")
				await rm(entry.diskPath, { recursive: true, force: true })
			}
		}
		// Record the deliberate removal so boot-time seeding skips the
		// bundled original (which stays untouched) until the user restores
		// it. Persisting the marker may fail — the uninstall must abort
		// then, or the plugin would silently come back on restart.
		seedRemovals.add(id)

		db.delete(contentPlugins).where(eq(contentPlugins.id, id)).run()
		sandbox.unloadPlugin(id)
		await loader.rescan()
	}

	function listSeedPlugins(): SeedPluginInfo[] {
		const removed = seedRemovals.read()
		const registry = loader.getRegistry()
		const out: SeedPluginInfo[] = []
		for (const dir of seedDirs) {
			const manifest = readSeedManifest(dir)
			if (manifest === undefined) continue
			const entry = registry.getById(manifest.id)
			const installed = entry !== undefined && !entry.missing
			out.push({
				id: manifest.id,
				manifest,
				installed,
				...(installed ? { installedVersion: entry.manifest.version } : {}),
				removed: removed.has(manifest.id),
				restorable: removed.has(manifest.id) && !installed,
			})
		}
		return out
	}

	function setMarketplaceSource(id: PluginManifestId, repo: string): void {
		const now = Date.now()
		const existing = db
			.select({ id: contentPlugins.id })
			.from(contentPlugins)
			.where(eq(contentPlugins.id, id))
			.get()
		if (existing === undefined) {
			// No settings row yet (the plugin was never configured): seed one
			// from the registry entry, mirroring `syncRecords`, so the source
			// is never lost to a missing row.
			const entry = loader.getRegistry().getById(id)
			if (entry === undefined) {
				throw new Error(`Plugin ${id} is not registered`)
			}
			insertSettingsRow(entry, {})
		}
		db.update(contentPlugins)
			.set({ sourceRepo: repo, updatedAt: now })
			.where(eq(contentPlugins.id, id))
			.run()
	}

	function listMarketplaceSources(): readonly {
		readonly id: PluginManifestId
		readonly repo: string
	}[] {
		return db
			.select({ id: contentPlugins.id, repo: contentPlugins.sourceRepo })
			.from(contentPlugins)
			.where(isNotNull(contentPlugins.sourceRepo))
			.all()
			.map((row) => ({ id: row.id, repo: row.repo! }))
	}

	async function restoreSeedPlugin(id: PluginManifestId): Promise<void> {
		const dir = seedDirs.find(
			(candidate) => readSeedManifest(candidate)?.id === id,
		)
		if (dir === undefined) {
			throw invalid(
				"plugin.seed_source_missing",
				"the bundled source of this plugin is not available on this host",
			)
		}
		if (loader.getRegistry().getById(id) !== undefined) {
			throw invalid(
				"plugin.seed_already_installed",
				"this plugin is already installed",
			)
		}
		seedRemovals.remove(id)
		await rescan()
	}

	return {
		listAll,
		getAssetVersion,
		supportsCapability,
		update,
		reorder,
		rescan,
		syncRecords,
		uninstall,
		listSeedPlugins,
		setMarketplaceSource,
		listMarketplaceSources,
		restoreSeedPlugin,
	}
}

/** Parse a seed directory's manifest with the contract schema, or
    undefined when unreadable/invalid — the bundled section skips junk. */
function readSeedManifest(dir: string): PluginManifest | undefined {
	try {
		const parsed: unknown = JSON.parse(
			readFileSync(join(dir, "manifest.json"), "utf-8"),
		)
		const result = pluginManifestSchema.safeParse(parsed)
		return result.success ? result.data : undefined
	} catch {
		return undefined
	}
}

function intBool(value: boolean): number {
	return value ? 1 : 0
}
