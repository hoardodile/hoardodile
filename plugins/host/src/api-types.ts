import type { PluginManifest, PluginManifestId } from "@hoardodile/sdk-types"
import type { PluginDefinition } from "./types.ts"

export type { PluginDefinition }

/** A plugin discovered on disk — not yet imported/activated. */
export type FoundPlugin = {
	readonly id: PluginManifestId
	readonly manifest: PluginManifest
	readonly diskPath: string
	readonly source: "builtin" | "dev" | "disk"
	readonly enabled: boolean
	readonly priority: number
	readonly pinned: boolean
	readonly color: string
}

/** A plugin known to the DB but missing from disk. */
export type MissingPlugin = {
	readonly id: PluginManifestId
	readonly manifest: PluginManifest
	readonly enabled: boolean
	readonly priority: number
	readonly pinned: boolean
	readonly color: string
}

/** A loaded plugin entry in the runtime registry. */
export type PluginRegistryEntry = {
	readonly id: PluginManifestId
	readonly manifest: PluginManifest
	readonly enabled: boolean
	readonly priority: number
	readonly pinned: boolean
	readonly color: string
	readonly missing: boolean
	readonly builtin: boolean
	readonly dev: boolean
	readonly plugin: PluginDefinition
	/** Absolute path to the plugin directory on disk. Undefined for builtin / in-memory plugins. */
	readonly diskPath?: string
}

/** The plugin registry — built at startup and kept in memory. */
export type PluginRegistry = {
	getAll(): readonly PluginRegistryEntry[]
	getEnabled(): readonly PluginRegistryEntry[]
	getById(id: PluginManifestId): PluginRegistryEntry | undefined
	getBuiltin(): PluginRegistryEntry | undefined
	getForResource(resPluginId: PluginManifestId): PluginRegistryEntry | undefined
	updateEntry(
		id: PluginManifestId,
		patch: Partial<
			Pick<
				PluginRegistryEntry,
				"enabled" | "priority" | "pinned" | "color" | "missing"
			>
		>,
	): void
}
