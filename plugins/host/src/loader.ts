import type { PluginManifestId } from "@hoardodile/sdk-types"
import { createPluginActivation } from "./activation.ts"
import type { PluginRegistry, PluginRegistryEntry } from "./api-types.ts"
import { createPluginDiscovery } from "./discovery.ts"
import { createPluginSandbox, type PluginSandbox } from "./sandbox/host.ts"
import { seedPlugins } from "./seed.ts"
import type { PluginSettingsStore } from "./settings-store.ts"

export { seedPlugins } from "./seed.ts"

/**
 * Loads plugins into a live {@link PluginRegistry}: seed the configured
 * plugin directories, discover, activate, and sort by priority.
 * `loadAll`/`rescan` are serialized — an overlapping run would replace
 * workers out from under the previous run's in-flight loads.
 *
 * The previous registry and its workers are only replaced AFTER the new
 * registry finished activating: a failed load never strands a stale
 * registry whose workers were already disposed (every hook would then
 * fail until the next restart).
 */
export type PluginLoader = {
	readonly loadAll: () => Promise<PluginRegistry>
	readonly rescan: () => Promise<PluginRegistry>
	/** The current registry; throws when `loadAll` has not run yet. */
	readonly getRegistry: () => PluginRegistry
}

export type PluginLoaderDeps = {
	readonly builtinDir?: string
	readonly devPluginDirs?: readonly string[]
	/**
	 * Plugin directories (each with `manifest.json` at its root, e.g. a
	 * built plugin's `dist/`) that are seeded into `pluginsDir` on every
	 * load. Each plugin is copied into `pluginsDir/<manifest.id>` before
	 * discovery runs when the destination tree differs — so a seeded
	 * plugin behaves like a regular installed one (DB settings, caching,
	 * uninstall). The server passes an empty list and seeds through
	 * `writeVersioned` instead. When omitted, nothing is seeded.
	 */
	readonly seedPluginDirs?: readonly string[]
	readonly pluginsDir: string
	readonly settings: PluginSettingsStore
	readonly disableDevPlugins?: boolean
	/**
	 * Worker-thread sandbox that executes plugin hooks. Optional so tests
	 * without any `main.js` on disk can omit it; the default spawns real
	 * workers when a loadable bundle is found.
	 */
	readonly sandbox?: PluginSandbox
	/**
	 * Optional timing sink for boot diagnostics — receives the duration of
	 * each `loadAll` step. Defaults to a no-op so tests stay quiet.
	 */
	readonly onTiming?: (step: string, ms: number) => void
}

/**
 * Create the plugin loader. Workers are respawned on every load so a
 * rescan picks up changed plugin code — the new worker re-imports
 * `main.js`, bypassing the main thread's ESM module cache. Configured
 * {@link PluginLoaderDeps.seedPluginDirs} are copied into `pluginsDir`
 * on each load.
 */
export function createPluginLoader(deps: PluginLoaderDeps): PluginLoader {
	let registry: PluginRegistry | undefined
	// Serializes loadAll/rescan: an overlapping run would replace workers
	// out from under the previous run's in-flight plugin loads.
	let chain: Promise<unknown> = Promise.resolve()

	const discovery = createPluginDiscovery(deps)
	const sandbox = deps.sandbox ?? createPluginSandbox()
	const activation = createPluginActivation({ sandbox })

	function loadAll(): Promise<PluginRegistry> {
		const run = chain.then(doLoadAll)
		chain = run.catch(() => {})
		return run
	}

	async function doLoadAll(): Promise<PluginRegistry> {
		// Seed first — tolerant of individual failures: a locked directory
		// (Windows/AV races with a plugin watch rebuilding dist) only skips
		// that plugin instead of aborting the whole load.
		const seedStart = performance.now()
		seedPlugins(deps.pluginsDir, deps.seedPluginDirs)
		deps.onTiming?.("seed", Math.round(performance.now() - seedStart))

		const discoverStart = performance.now()
		const { found, missing } = await discovery.discover()
		deps.onTiming?.("discover", Math.round(performance.now() - discoverStart))

		// Activate BEFORE disposing anything from the previous registry:
		// same-id plugins replace their worker in the sandbox, and a
		// failure anywhere above leaves the previous registry (and its
		// workers) fully alive instead of stranding a stale registry with
		// disposed workers.
		const activateStart = performance.now()
		const activated = await activation.activateAll(found)
		deps.onTiming?.("activate", Math.round(performance.now() - activateStart))

		const failing = activation.createFailingEntries(missing)

		const entries = [...activated, ...failing]
		entries.sort((a, b) => a.priority - b.priority)

		const next = buildRegistry(entries)
		// Plugins that left the registry (uninstalled/removed) free their
		// workers; everything still registered keeps the worker activation
		// just loaded.
		await sandbox.disposeExcept(new Set(next.getAll().map((e) => e.id)))
		registry = next
		return registry
	}

	async function rescan(): Promise<PluginRegistry> {
		return loadAll()
	}

	function getRegistry(): PluginRegistry {
		if (registry === undefined) {
			throw new Error("Plugin registry not initialised — call loadAll() first")
		}
		return registry
	}

	return { loadAll, rescan, getRegistry }
}

/**
 * Build the immutable-ish registry from entries, keyed by plugin UUID.
 * Duplicate ids keep the first entry and warn (the UUID contract is
 * unique — duplicates signal a broken install). Duplicates are dropped
 * from every accessor, not just the id map: keeping a duplicate in
 * `getAll()` would make enabled-list iteration invoke a plugin whose
 * worker activation already replaced (and disposed) the first load.
 * `updateEntry` patches a single entry in place and re-sorts by priority.
 */
export function buildRegistry(
	entries: readonly PluginRegistryEntry[],
): PluginRegistry {
	const byId = new Map<PluginManifestId, PluginRegistryEntry>()
	const deduped: PluginRegistryEntry[] = []
	for (const entry of entries) {
		const existing = byId.get(entry.id)
		if (existing !== undefined) {
			console.warn(
				`[plugin-loader] skipping ${entry.id}: UUID conflicts with already registered plugin (${existing.manifest.name ?? existing.id}), keeping first`,
			)
			continue
		}
		byId.set(entry.id, entry)
		deduped.push(entry)
	}

	let sortedEntries = deduped

	return {
		getAll(): readonly PluginRegistryEntry[] {
			return sortedEntries
		},
		getEnabled(): readonly PluginRegistryEntry[] {
			return sortedEntries.filter((e) => e.enabled)
		},
		getById(id: PluginManifestId): PluginRegistryEntry | undefined {
			return byId.get(id)
		},
		getBuiltin(): PluginRegistryEntry | undefined {
			return sortedEntries.find((e) => e.builtin)
		},
		getForResource(
			resPluginId: PluginManifestId,
		): PluginRegistryEntry | undefined {
			const entry = byId.get(resPluginId)
			if (entry === undefined || !entry.enabled) return undefined
			return entry
		},
		updateEntry(
			id: PluginManifestId,
			patch: Partial<
				Pick<
					PluginRegistryEntry,
					"enabled" | "priority" | "pinned" | "color" | "missing"
				>
			>,
		): void {
			const index = sortedEntries.findIndex((e) => e.id === id)
			if (index === -1) return
			const old = sortedEntries[index]
			if (old === undefined) return
			const updated: PluginRegistryEntry = {
				id: old.id,
				manifest: old.manifest,
				plugin: old.plugin,
				diskPath: old.diskPath,
				enabled: patch.enabled ?? old.enabled,
				priority: patch.priority ?? old.priority,
				pinned: patch.pinned ?? old.pinned,
				color: patch.color ?? old.color,
				missing: patch.missing ?? old.missing,
				builtin: old.builtin,
				dev: old.dev,
			}
			sortedEntries = [
				...sortedEntries.slice(0, index),
				updated,
				...sortedEntries.slice(index + 1),
			]
			sortedEntries.sort((a, b) => a.priority - b.priority)
			byId.set(id, updated)
		},
	}
}
