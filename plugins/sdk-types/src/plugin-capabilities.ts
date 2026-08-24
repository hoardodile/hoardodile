/**
 * The single permission→capability declaration: every manifest
 * permission key, what it gates, and which runtime layers enforce it.
 * Consumers read this table instead of hand-mirrored sets — a new
 * permission is declared once here, and the compile-time coverage
 * checks below make a missing declaration impossible.
 *
 * This module is pure TypeScript (no zod): it is type-driven off
 * {@link PluginPermissions} and consumed by the host sandbox, the
 * server domain and the tooling. Plugin bundles never import it.
 */
import type { PluginPermissions } from "./manifest.ts"

export type PluginCapabilityGate = {
	/** One-line contract description (mirrors the manifest schema docs). */
	readonly description: string
	/**
	 * ResourceAPI method names gated at the sandbox RPC boundary. Absent
	 * means the permission is enforced at the host/service layer only
	 * (meta hooks, web routes).
	 */
	readonly sandboxMethods?: readonly string[]
}

/**
 * The capability gates, keyed by the manifest permission key. The
 * `satisfies` below fails to compile when a permission is declared on
 * the manifest but missing here; the AssertTrue checks at the bottom
 * cover the reverse direction.
 */
export const PLUGIN_CAPABILITY_GATES = {
	sourceMeta: {
		description: "Read/write the resource's source metadata (sourceMeta hook).",
	},
	searchMeta: {
		description: "Produce and store search metadata facets (searchMeta hook).",
	},
	danmaku: {
		description: "Create/list danmaku for resources this plugin renders.",
	},
	message: {
		description: "Create/list messages for resources this plugin renders.",
	},
	imageHashes: {
		description:
			"Produce content hashes for duplicate detection / image similarity.",
	},
	container: {
		description:
			"List and extract archive (zip/tar/7z/…) entries; the only API surface with a write side effect.",
		sandboxMethods: ["listContainer", "extractArchive"],
	},
	download: {
		description:
			"The plugin asset vault: user-consented downloads into the plugin's own vault/ plus the vault read/delete methods; denied by default and per-download by the user.",
		sandboxMethods: ["download", "statAsset", "readAsset", "deleteAsset"],
	},
} as const satisfies Record<keyof PluginPermissions, PluginCapabilityGate>

export type PluginCapabilityKey = keyof typeof PLUGIN_CAPABILITY_GATES

// -- compile-time coverage --------------------------------------------------
// Every manifest permission key is declared here and nothing more — the
// two assertions fail the build on either drift. Exported only so
// noUnusedLocals keeps them alive — never import.
type AssertTrue<T extends true> = T
export type _ManifestKeysCovered = AssertTrue<
	keyof PluginPermissions extends keyof typeof PLUGIN_CAPABILITY_GATES
		? true
		: false
>
export type _TableKeysCovered = AssertTrue<
	keyof typeof PLUGIN_CAPABILITY_GATES extends keyof PluginPermissions
		? true
		: false
>

/** Sandbox API method → capability key, derived once from the table. */
export const CAPABILITY_BY_METHOD: ReadonlyMap<string, PluginCapabilityKey> =
	new Map(
		(
			Object.entries(PLUGIN_CAPABILITY_GATES) as [
				PluginCapabilityKey,
				PluginCapabilityGate,
			][]
		).flatMap(([capability, gate]) =>
			(gate.sandboxMethods ?? []).map(
				(method) => [method, capability] as [string, PluginCapabilityKey],
			),
		),
	)
