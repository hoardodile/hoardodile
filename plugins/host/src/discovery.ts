import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import type { PluginManifest, PluginManifestId } from "@hoardodile/sdk-types"
import { pluginManifest as pluginManifestSchema } from "@hoardodile/sdk-types/schema"
import type { FoundPlugin, MissingPlugin } from "./api-types.ts"
import type { PluginSettingsStore } from "./settings-store.ts"

/**
 * Default pin for plugins with no settings row yet (first install /
 * clean state / builtin). Pinned plugins wear their name on resource
 * cards so the type stays readable without a cover.
 */
const DEFAULT_PLUGIN_PINNED = true

/**
 * Default priorities for in-repo seed plugin ids.
 * Used when there is no DB row yet (first install / clean state).
 * Users can still override via drag-and-drop reorder.
 */
const OFFICIAL_PLUGIN_PRIORITY: Record<string, number> = {
	"665cfbdd-1db6-48f5-9d53-1008b8cb84c3": 200, // gallery
}

function getDefaultPriority(pluginId: PluginManifestId): number {
	return OFFICIAL_PLUGIN_PRIORITY[pluginId] ?? 100
}

export type PluginDiscoveryDeps = {
	/** Directory of the mandatory builtin plugin (`manifest.json` at its root). */
	readonly builtinDir?: string
	/** Extra plugin directories for development (override same-id disk plugins). */
	readonly devPluginDirs?: readonly string[]
	/** Directory where installed plugins live, one subdirectory per plugin. */
	readonly pluginsDir: string
	/** DB-backed per-plugin settings (enabled/priority/pinned/color). */
	readonly settings: PluginSettingsStore
	/** Skip dev plugins entirely (e.g. production configuration). */
	readonly disableDevPlugins?: boolean
}

/**
 * Plugin discovery: finds plugins on disk (builtin, dev, installed),
 * merges their DB settings, and reports which known plugins are missing.
 */
export type PluginDiscovery = {
	readonly discover: () => Promise<{
		found: FoundPlugin[]
		missing: MissingPlugin[]
	}>
}

/**
 * Create the discovery pipeline. Order matters: the builtin plugin wins
 * priority, dev plugins override same-id installed ones, and anything in
 * settings but absent from disk is reported missing.
 */
export function createPluginDiscovery(
	deps: PluginDiscoveryDeps,
): PluginDiscovery {
	// The first loadAll runs at boot: a broken builtin there is a config
	// error that should fail fast. Later (re)scans degrade gracefully —
	// the loader keeps the previous registry when discovery throws.
	let firstLoad = true

	async function discover(): Promise<{
		found: FoundPlugin[]
		missing: MissingPlugin[]
	}> {
		const found: FoundPlugin[] = []
		// Every discovered id, across all sources. Guarantees each plugin
		// id is activated exactly once — a duplicate would make activation
		// dispose the first worker while the registry still references it
		// (every hook then fails with "sandbox disposed").
		const seen = new Set<PluginManifestId>()

		// 1. Builtin plugin — its id is reserved; dev/disk copies are skipped.
		if (deps.builtinDir !== undefined) {
			const builtin = discoverBuiltin(deps.builtinDir, firstLoad)
			if (builtin !== undefined) {
				found.push(builtin)
				seen.add(builtin.id)
			}
		}
		firstLoad = false

		// 2. Dev plugins. Same-id dev dirs override each other (later wins,
		//    matching the dev-over-disk precedence); the earlier entry is
		//    replaced so activation never loads the same id twice.
		const dev = discoverDevPlugins(
			deps.devPluginDirs,
			deps.settings,
			deps.disableDevPlugins ?? false,
		)
		for (const plugin of dev) {
			if (seen.has(plugin.id)) {
				const index = found.findIndex((f) => f.id === plugin.id)
				if (index !== -1 && found[index]?.source === "dev") {
					// Duplicate dev dir — the later one wins.
					found[index] = plugin
					console.warn(
						`[plugin-discovery] dev plugin ${plugin.id} (${plugin.manifest.name ?? plugin.id}) overrides an earlier dev dir entry`,
					)
				} else {
					console.warn(
						`[plugin-discovery] skipping dev plugin ${plugin.id}: id is reserved by the builtin plugin`,
					)
				}
				continue
			}
			found.push(plugin)
			seen.add(plugin.id)
		}

		// 3. Disk plugins, skipping ids overridden by dev or the builtin.
		const disk = discoverDiskPlugins(deps.pluginsDir, deps.settings)
		for (const plugin of disk) {
			if (seen.has(plugin.id)) {
				console.warn(
					`[plugin-discovery] skipping disk plugin ${plugin.id}: id already registered (builtin or dev plugin)`,
				)
				continue
			}
			found.push(plugin)
			seen.add(plugin.id)
		}

		// 4. Missing plugins (settings-only)
		const missing = discoverMissingPlugins(deps.settings, seen)

		return { found, missing }
	}

	return { discover }
}

function discoverBuiltin(
	builtinDir: string,
	failFast: boolean,
): FoundPlugin | undefined {
	const resolved = resolve(builtinDir)
	const manifest = parseManifest(resolved, "builtin")
	if (manifest === undefined) {
		const message =
			`Builtin plugin not found or invalid at ${resolved}. ` +
			"Set BUILTIN_PATH env to a valid plugin directory."
		if (failFast) {
			throw new Error(message)
		}
		console.error(`[plugin-discovery] ${message}`)
		return undefined
	}
	return {
		id: manifest.id,
		manifest,
		diskPath: resolved,
		source: "builtin",
		enabled: true,
		priority: Number.MAX_SAFE_INTEGER,
		pinned: DEFAULT_PLUGIN_PINNED,
		color: "",
	}
}

function discoverDevPlugins(
	devPluginDirs: readonly string[] | undefined,
	settings: PluginSettingsStore,
	disableDevPlugins: boolean,
): FoundPlugin[] {
	if (disableDevPlugins) {
		console.info("[plugin-discovery] dev plugins disabled by configuration")
		return []
	}
	if (devPluginDirs === undefined || devPluginDirs.length === 0) return []

	const results: FoundPlugin[] = []
	for (const dir of devPluginDirs) {
		const resolved = resolve(dir)
		const manifest = parseManifest(resolved, "dev")
		if (manifest === undefined) continue

		const row = settings.get(manifest.id)

		results.push({
			id: manifest.id,
			manifest,
			diskPath: resolved,
			source: "dev",
			enabled: true,
			priority: row?.priority ?? getDefaultPriority(manifest.id),
			pinned: row?.pinned ?? DEFAULT_PLUGIN_PINNED,
			color: row?.color ?? "",
		})
	}
	return results
}

function discoverDiskPlugins(
	pluginsDir: string,
	settings: PluginSettingsStore,
): FoundPlugin[] {
	if (!existsSync(pluginsDir)) return []

	const dirents = readdirSync(pluginsDir, { withFileTypes: true })
	if (dirents.length === 0) return []

	const results: FoundPlugin[] = []
	for (const dirent of dirents) {
		if (!dirent.isDirectory()) continue
		const dirPath = join(pluginsDir, dirent.name)

		const manifest = parseManifest(dirPath, dirent.name)
		if (manifest === undefined) continue

		const row = settings.get(manifest.id)
		const enabled = row?.enabled ?? true
		const priority = row?.priority ?? getDefaultPriority(manifest.id)
		const pinned = row?.pinned ?? DEFAULT_PLUGIN_PINNED
		const color = row?.color ?? ""

		results.push({
			id: manifest.id,
			manifest,
			diskPath: dirPath,
			source: "disk",
			enabled,
			priority,
			pinned,
			color,
		})
	}
	return results
}

function discoverMissingPlugins(
	settings: PluginSettingsStore,
	loadedIds: ReadonlySet<PluginManifestId>,
): MissingPlugin[] {
	const results: MissingPlugin[] = []
	for (const row of settings.all()) {
		if (loadedIds.has(row.id)) continue
		let manifest: PluginManifest
		try {
			manifest = JSON.parse(row.manifest) as PluginManifest
		} catch {
			continue
		}
		results.push({
			id: row.id,
			manifest,
			enabled: row.enabled,
			priority: row.priority,
			pinned: row.pinned,
			color: row.color,
		})
	}
	return results
}

/**
 * Read and validate `manifest.json` in `dirPath` against the zod
 * contract. Logs a warning and returns `undefined` for every failure
 * mode (missing file, unreadable, invalid JSON, schema violation) so
 * callers can skip the directory without crashing the scan.
 */
export function parseManifest(
	dirPath: string,
	dirName: string,
): PluginManifest | undefined {
	const manifestPath = join(dirPath, "manifest.json")
	if (!existsSync(manifestPath)) {
		console.warn(`[plugin-discovery] skipping ${dirName}: no manifest.json`)
		return undefined
	}

	let raw: string
	try {
		raw = readFileSync(manifestPath, "utf-8")
	} catch {
		console.warn(
			`[plugin-discovery] skipping ${dirName}: cannot read manifest.json`,
		)
		return undefined
	}

	let parsed: unknown
	try {
		parsed = JSON.parse(raw)
	} catch {
		console.warn(
			`[plugin-discovery] skipping ${dirName}: manifest is not valid JSON`,
		)
		return undefined
	}

	const result = pluginManifestSchema.safeParse(parsed)
	if (!result.success) {
		console.warn(
			`[plugin-discovery] skipping ${dirName}: invalid manifest`,
			result.error,
		)
		return undefined
	}

	return result.data
}
