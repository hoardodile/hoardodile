/**
 * Plugin asset runtime limits — the constants shared by the host, the
 * SDK validators and the tooling. Backed by the `./plugin-asset-limits`
 * subpath (plugin-facing constants never export from the root entry).
 */

/** Max length of a vault-relative `dest` (a plugin path is bounded, not arbitrary). */
export const PLUGIN_ASSET_DEST_MAX_LENGTH = 256

/** Max length of the optional human `reason` shown in the consent dialog. */
export const PLUGIN_ASSET_REASON_MAX_LENGTH = 200

/**
 * Max items in one batched `download([...])` call. One call = one consent
 * ticket = one dialog listing every item; beyond this the host rejects
 * with `POLICY` (a burst must not stack unbounded tickets per plugin).
 */
export const PLUGIN_ASSET_BATCH_MAX_ITEMS = 16

/** Expected shape of an SRI-style sha256 pin: 64 lowercase hex characters. */
export const PLUGIN_ASSET_SHA256_PATTERN = /^[0-9a-f]{64}$/

/** The machine-readable asset error names, in contract order. */
export const PLUGIN_ASSET_ERROR_NAMES = [
	"DENIED",
	"UNAVAILABLE",
	"POLICY",
] as const

export type PluginAssetErrorName = (typeof PLUGIN_ASSET_ERROR_NAMES)[number]
