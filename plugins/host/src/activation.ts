import { existsSync } from "node:fs"
import { join } from "node:path"
import type {
	FoundPlugin,
	MissingPlugin,
	PluginDefinition,
	PluginRegistryEntry,
} from "./api-types.ts"
import { createFailingPlugin } from "./define-plugin.ts"
import type { PluginSandbox } from "./sandbox/host.ts"

/**
 * Plugin activation: turns discovered plugin candidates (found on disk
 * or recorded as missing) into ready {@link PluginRegistryEntry}s by
 * loading their `main.js` into the sandbox. Loads run in parallel —
 * sequential worker spawns would multiply the boot cost on slow or
 * antivirus-scanned disks.
 */
export type PluginActivation = {
	/** Load every found plugin's `main.js` into the sandbox and return the full registry entries. */
	readonly activateAll: (
		found: readonly FoundPlugin[],
	) => Promise<PluginRegistryEntry[]>
	/**
	 * Build registry entries for plugins whose directory is missing, each
	 * carrying a failing definition so callers can still render them as
	 * broken in the UI.
	 */
	readonly createFailingEntries: (
		missing: readonly MissingPlugin[],
	) => PluginRegistryEntry[]
}

export type PluginActivationDeps = {
	readonly sandbox: PluginSandbox
}

/**
 * Create the activation pipeline. The sandbox decides worker lifetimes:
 * enabled plugins keep their worker alive, disabled ones only probe the
 * hook list and respawn lazily if a bound resource still invokes a hook.
 */
export function createPluginActivation(
	deps: PluginActivationDeps,
): PluginActivation {
	async function activateAll(
		found: readonly FoundPlugin[],
	): Promise<PluginRegistryEntry[]> {
		// Load plugin bundles in parallel — sequential worker spawns multiply
		// the boot cost on slow or antivirus-scanned disks. Array order is
		// kept by `map`, and `loadAll` re-sorts by priority afterwards anyway.
		return Promise.all(
			found.map(async (candidate) => {
				const plugin = await loadDiskPlugin(deps.sandbox, candidate)
				return {
					id: candidate.id,
					manifest: candidate.manifest,
					enabled: candidate.enabled,
					priority: candidate.priority,
					pinned: candidate.pinned,
					color: candidate.color,
					missing: false,
					builtin: candidate.source === "builtin",
					dev: candidate.source === "dev",
					plugin,
					diskPath: candidate.diskPath,
				}
			}),
		)
	}

	function createFailingEntries(
		missing: readonly MissingPlugin[],
	): PluginRegistryEntry[] {
		return missing.map((m) => ({
			id: m.id,
			manifest: m.manifest,
			enabled: m.enabled,
			priority: m.priority,
			pinned: m.pinned,
			color: m.color,
			missing: true,
			builtin: false,
			dev: false,
			plugin: createFailingPlugin(["plugin directory not found"]),
		}))
	}

	return { activateAll, createFailingEntries }
}

async function loadDiskPlugin(
	sandbox: PluginSandbox,
	candidate: FoundPlugin,
): Promise<PluginDefinition> {
	const mainJsPath = join(candidate.diskPath, "main.js")
	if (!existsSync(mainJsPath)) {
		console.warn(`[plugin-activation] ${candidate.id}: no main.js, not loaded`)
		return createFailingPlugin(["main.js not found"])
	}

	// Enabled plugins keep their worker alive; disabled ones only probe the
	// hook list — their worker respawns lazily if a bound resource still
	// invokes a hook.
	const plugin = await sandbox.loadPlugin({
		id: candidate.id,
		mainPath: mainJsPath,
		eager: candidate.enabled,
		// The sandbox enforces manifest-gated API surface (container).
		permissions: candidate.manifest.permissions,
	})
	if (plugin === undefined) {
		return createFailingPlugin(["main.js load error"])
	}
	return plugin
}
