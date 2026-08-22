import type { PluginManifestId } from "@hoardodile/sdk-types"

/**
 * A plugin's persisted settings — the union of what the server's DB row
 * and the CLI's defaults provide. `undefined` field values mean "no
 * setting recorded" (fresh install), not a stored default.
 */
export type PluginSettingsRow = {
	readonly id: PluginManifestId
	/** Raw `manifest.json` text as stored by the consumer. */
	readonly manifest: string
	readonly enabled: boolean
	readonly priority: number
	readonly pinned: boolean
	readonly color: string
}

/**
 * Storage seam for plugin settings (enablement, priority, pin, color).
 * The server implements it over its `content_plugins` table; the CLI uses
 * an in-memory default. Keeps the host free of any database dependency.
 */
export type PluginSettingsStore = {
	readonly get: (id: PluginManifestId) => PluginSettingsRow | undefined
	readonly all: () => readonly PluginSettingsRow[]
}
