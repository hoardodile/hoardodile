/**
 * Shared definition of the seed plugin channel: which plugin dists ship
 * with the app as seeds, and where they are discovered.
 *
 * "Seed" on purpose — the set is whatever a deployer configures (or the
 * desktop packages); it is not a publisher's guarantee. A seed plugin is
 * an installed, uninstallable plugin; `file` (the builtin fallback, wired
 * through BUILTIN_PATH) and `template` (the scaffolder scaffold) are the
 * generic exclusions, never seeds.
 *
 * Used by:
 *  - stage-resources.mjs — copies every found plugin dist into
 *    extraResources/plugins/<slug>;
 *  - scripts/dev.mjs — generic dist-presence checks and the seed-wins
 *    dev-path filter (by manifest id).
 * `apps/desktop/src/main/paths.ts` keeps the same rule at runtime (it
 * discovers seeds from the packaged `plugins/` folder); keep the two
 * exclusion sets in sync.
 */
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join, resolve } from "node:path"

/** Plugin dirs that are never seeds (see file header). */
export const SEED_PLUGIN_EXCLUDES = ["file", "template"]

/**
 * Every plugin dist in the workspace that ships as a seed:
 * `plugins/<slug>/dist` carrying a `manifest.json`, excluding
 * {@link SEED_PLUGIN_EXCLUDES}. Deterministic (sorted by slug).
 */
export function findSeedPluginDists(workspaceRoot) {
	const pluginsRoot = resolve(workspaceRoot, "plugins")
	const out = []
	if (!existsSync(pluginsRoot)) return out
	for (const name of readdirSync(pluginsRoot, { withFileTypes: true })) {
		if (!name.isDirectory()) continue
		if (SEED_PLUGIN_EXCLUDES.includes(name.name)) continue
		const dist = join(pluginsRoot, name.name, "dist")
		if (!existsSync(join(dist, "manifest.json"))) continue
		out.push(dist)
	}
	return out.sort()
}

/** The manifest id of a plugin directory, or undefined when unreadable. */
export function readPluginId(dir) {
	try {
		const manifest = JSON.parse(
			readFileSync(join(dir, "manifest.json"), "utf-8"),
		)
		return typeof manifest.id === "string" ? manifest.id : undefined
	} catch {
		return undefined
	}
}
