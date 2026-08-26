/**
 * The plugin asset contract — the download / read / delete surface of a
 * plugin's own "vault". The vault is a host-reserved namespace inside the
 * plugin's installed directory (`<plugin-dir>/vault/`) that the host
 * manages on the plugin's behalf: data lands there only through the
 * user-consented download API, and nothing a plugin ships in its zip can
 * ever be overwritten by downloading (see the vault-confined `dest`
 * rules).
 *
 * Both sides of the plugin speak the same shapes: the server-side
 * `ResourceAPI` (main.js hooks) and the iframe `WebPluginAPI` (render)
 * call the same four methods with the same request/result vocabulary.
 * `download` also accepts an **array of requests** — one batched call is
 * ONE consent question (the dialog lists every item) and is all-or-nothing
 * (results arrive in request order; any failure commits nothing).
 * All methods are gated by the manifest `download` permission and
 * denied inside the sandbox when the manifest does not declare it.
 *
 * Error convention (fixed rule): **classification uses `Result`,
 * API calls throw.** `detect` (and other classifiers) return a
 * {@link Result}; every other API method rejects with an `Error` whose
 * `name` carries the machine-readable code. Plugins branch on
 * {@link isPluginAssetError} — never parse messages.
 *
 * Runtime limits live behind `@hoardodile/sdk-types/plugin-asset-limits`;
 * this module exports the types and the error helpers only.
 */
import type { PluginAssetErrorName } from "./plugin-asset-limits.ts"

export type { PluginAssetErrorName }

/**
 * A download request: the plugin declares the plaintext URL, the vault
 * destination, and (optionally) an integrity pin plus a reason for the
 * consent dialog. `dest` is vault-relative only — it must resolve under
 * `<plugin-dir>/vault/` and can never reach the plugin's own bundled
 * files (`main.js`, `index.html`, `assets/`, ...).
 */
export type PluginDownloadRequest = {
	/** Absolute `http(s)` URL to fetch. Shown verbatim in the consent dialog. */
	readonly url: string
	/**
	 * Vault-relative destination path (`"runtime/live2d.min.js"`). The host
	 * resolves it inside the plugin vault and rejects absolute paths,
	 * `..` traversal, path separators crossing segments, and reserved
	 * names — before any network request is made.
	 */
	readonly dest: string
	/**
	 * Optional SRI-style integrity pin (64 lowercase hex chars). When
	 * present the host verifies the downloaded bytes against it and
	 * discards a mismatch, so a tampered or corrupted response can
	 * never be stored.
	 */
	readonly sha256?: string
	/** Optional short rationale shown in the consent dialog (plugin-authored copy). */
	readonly reason?: string
}

/**
 * Result of {@link PluginDownloadRequest}: the stored file's identity.
 * `cached` is true when the destination already existed — the host
 * answered from the vault without any dialog and without touching the
 * network (downloads are "ensure present", never unconditional).
 */
export type PluginDownloadResult = {
	/** The vault-relative destination that was resolved. */
	readonly path: string
	readonly sizeBytes: number
	/** sha256 of the stored bytes (host-computed, always present). */
	readonly sha256: string
	/** True when the file already existed and no consent/network was needed. */
	readonly cached: boolean
}

/**
 * Result of {@link ResourceAPI.deleteAsset} / `WebPluginAPI.deleteAsset`.
 * Deletion is idempotent: removing nothing is not an error.
 */
export type PluginAssetDeleteResult = {
	/** True when a file was actually removed. */
	readonly existed: boolean
}

/**
 * Error thrown by the asset methods. The name survives both wire
 * boundaries (worker IPC and the iframe postMessage bridge), so plugin
 * code can branch on `err.name` without parsing messages:
 *
 * - `DENIED` — the user declined the consent dialog, or consent timed out.
 * - `UNAVAILABLE` — this runtime has no consent channel (CLI, workbench,
 *   offline mock) or the server is in read-only archive mode.
 * - `POLICY` — the host rejected the request before downloading:
 *   manifest lacks the `download` permission, the URL or `dest` is not
 *   allowed, the destination is a directory, or a quota would be
 *   exceeded. Also used for reserved-name conflicts.
 *
 * Transport/network failures keep their own error names (e.g. socket
 * errors) and are not part of this vocabulary.
 */
export class PluginAssetError extends Error {
	constructor(
		readonly code: PluginAssetErrorName,
		message: string,
	) {
		super(message)
		this.name = code
	}
}

/**
 * Narrow an asset error to a machine-readable name. Works across the
 * RPC boundaries because both preserve `Error.name` (the worker IPC and
 * the iframe bridge carry the name explicitly) — the instance is often
 * lost in transit, so the check keys on the name alone.
 */
export function isPluginAssetError(
	err: unknown,
	name: PluginAssetErrorName,
): err is PluginAssetError {
	return err instanceof Error && err.name === name
}

/** Build a `PluginAssetError` carrying the given machine-readable name. */
export function pluginAssetError(
	name: PluginAssetErrorName,
	message: string,
): PluginAssetError {
	return new PluginAssetError(name, message)
}
