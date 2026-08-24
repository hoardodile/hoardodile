import type { PluginManifest } from "@hoardodile/sdk-types"
import type {
	PluginCapabilityGate,
	PluginCapabilityKey,
} from "@hoardodile/sdk-types/plugin-capabilities"
import { PLUGIN_CAPABILITY_GATES } from "@hoardodile/sdk-types/plugin-capabilities"
import type { PluginRegistryEntry } from "./api-types.ts"

/**
 * Capabilities a plugin manifest can declare — derived from the single
 * {@link PLUGIN_CAPABILITY_GATES} table (which is itself keyed by the
 * manifest's `PluginPermissions` keys), so the guard can never drift.
 */
export type PluginCapability = PluginCapabilityKey

/** Gate metadata a consumer may want (e.g. for tooltips). */
export type { PluginCapabilityGate }

/**
 * Permission checks against a plugin's declared manifest permissions,
 * reading the capability vocabulary from the shared gates table.
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

export { PLUGIN_CAPABILITY_GATES }
