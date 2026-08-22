import type { PluginManifest } from "@hoardodile/sdk-types"
import type { PluginRegistryEntry } from "./api-types.ts"

/**
 * Capabilities a plugin manifest can declare, mirroring the keys of
 * `pluginPermissions` in `@hoardodile/sdk-types`. The guard enforces
 * that a plugin only touches API surfaces its manifest granted it.
 */
export type PluginCapability =
	| "sourceMeta"
	| "searchMeta"
	| "danmaku"
	| "message"
	| "imageHashes"

/**
 * Permission checks against a plugin's declared manifest permissions.
 * The server uses these before routing any plugin-scoped work so a
 * manifest that does not declare a capability cannot trigger it.
 */
export type CapabilityGuard = {
	/** Check whether a manifest grants the given capability. */
	readonly check: (
		manifest: PluginManifest,
		capability: PluginCapability,
	) => boolean
	/** Assert that a manifest grants the given capability; throw if not. */
	readonly require: (
		manifest: PluginManifest,
		capability: PluginCapability,
	) => void
	/** Filter entries to only those that grant the given capability. */
	readonly filter: (
		entries: readonly PluginRegistryEntry[],
		capability: PluginCapability,
	) => readonly PluginRegistryEntry[]
}

/** Create a stateless capability guard over manifest permissions. */
export function createCapabilityGuard(): CapabilityGuard {
	function check(
		manifest: PluginManifest,
		capability: PluginCapability,
	): boolean {
		return manifest.permissions[capability] === true
	}

	function require(
		manifest: PluginManifest,
		capability: PluginCapability,
	): void {
		if (!check(manifest, capability)) {
			throw new Error(
				`${capability} permission denied for plugin ${manifest.id}`,
			)
		}
	}

	function filter(
		entries: readonly PluginRegistryEntry[],
		capability: PluginCapability,
	): readonly PluginRegistryEntry[] {
		return entries.filter((e) => check(e.manifest, capability))
	}

	return { check, require, filter }
}
