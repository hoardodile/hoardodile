/**
 * The plugin asset service: the one pipeline behind both plugin sides.
 * The sandbox host routes `download`/`statAsset`/`readAsset`/
 * `deleteAsset` here (with the owning plugin id), and the web's iframe
 * requests reach the same methods through the `pluginAsset` tRPC router —
 * one authorization gate, one consent flow, one vault, one downloader.
 *
 * Order of business (download): registry + permission check → request
 * validation (URL policy, dest confinement — before any network) →
 * vault stat (cached files resolve silently) → consent (or session
 * remember) → HEAD size probe (for the dialog) → streamed download with
 * caps → SRI-style sha256 verification → atomic commit.
 */
import { mkdir } from "node:fs/promises"
import type { StoragePaths } from "@hoardodile/host/hoard"
import {
	commitVaultFile,
	discardVaultTempFile,
	PluginVaultPathError,
	parsePluginVaultDest,
	vaultFileSha256,
	vaultReadFile,
	vaultRemoveFile,
	vaultStatFile,
	vaultTempFile,
	writeVersioned,
} from "@hoardodile/host/hoard"
import type {
	PluginAssetDeleteResult,
	PluginDownloadRequest,
	PluginDownloadResult,
	PluginManifest,
} from "@hoardodile/sdk-types"
import { pluginAssetError } from "@hoardodile/sdk-types"
import {
	PLUGIN_ASSET_DEST_MAX_LENGTH,
	PLUGIN_ASSET_REASON_MAX_LENGTH,
	PLUGIN_ASSET_SHA256_PATTERN,
} from "@hoardodile/sdk-types/plugin-asset-limits"
import type { ConsentBroker } from "./consent.ts"
import type { PluginDownloader } from "./downloader.ts"

export type PluginAssetServiceDeps = {
	readonly paths: StoragePaths
	readonly readOnly: boolean
	/** Registry lookup (structural): the plugin must exist, be enabled and grant `download`. */
	readonly getPlugin: (pluginId: string) =>
		| {
				readonly manifest: PluginManifest
				readonly enabled: boolean
				readonly missing?: boolean
		  }
		| undefined
	readonly consent: ConsentBroker
	readonly downloader: PluginDownloader
	readonly maxFileBytes: number
	readonly maxTotalBytes: number
	readonly maxReadAssetBytes: number
}

export type PluginAssetService = {
	readonly requestDownload: (
		pluginId: string,
		request: PluginDownloadRequest,
	) => Promise<PluginDownloadResult>
	readonly statAsset: (
		pluginId: string,
		path: string,
	) => Promise<{ readonly sizeBytes: number } | undefined>
	readonly readAsset: (pluginId: string, path: string) => Promise<Uint8Array>
	readonly deleteAsset: (
		pluginId: string,
		path: string,
	) => Promise<PluginAssetDeleteResult>
}

export function createPluginAssetService(
	deps: PluginAssetServiceDeps,
): PluginAssetService {
	/** Map vault path violations onto the machine-readable POLICY name. */
	function asPolicy<T>(run: () => Promise<T>): Promise<T> {
		return run().catch((err) => {
			if (err instanceof PluginVaultPathError) {
				throw pluginAssetError("POLICY", err.message)
			}
			throw err
		})
	}

	/**
	 * The authoritative live-registry check. The sandbox additionally
	 * gates the same methods against the manifest snapshot taken at
	 * worker load — after a rescan that snapshot can be stale while this
	 * check always sees the current manifest (defense in depth, two
	 * sources by design).
	 */
	function assertPluginAllowed(pluginId: string): PluginManifest {
		const entry = deps.getPlugin(pluginId)
		if (
			entry === undefined ||
			entry.enabled !== true ||
			entry.missing === true
		) {
			throw pluginAssetError(
				"POLICY",
				`plugin ${pluginId} is not available for asset operations`,
			)
		}
		if (entry.manifest.permissions.download !== true) {
			throw pluginAssetError(
				"POLICY",
				`download permission denied for plugin ${pluginId} — declare "download": true in the manifest`,
			)
		}
		return entry.manifest
	}

	function validateRequest(request: PluginDownloadRequest): {
		readonly url: string
		readonly dest: string
	} {
		if (request.dest.length > PLUGIN_ASSET_DEST_MAX_LENGTH) {
			throw pluginAssetError(
				"POLICY",
				`plugin vault destination exceeds ${PLUGIN_ASSET_DEST_MAX_LENGTH} characters`,
			)
		}
		if (
			request.reason !== undefined &&
			request.reason.length > PLUGIN_ASSET_REASON_MAX_LENGTH
		) {
			throw pluginAssetError(
				"POLICY",
				`plugin download reason exceeds ${PLUGIN_ASSET_REASON_MAX_LENGTH} characters`,
			)
		}
		if (
			request.sha256 !== undefined &&
			!PLUGIN_ASSET_SHA256_PATTERN.test(request.sha256)
		) {
			throw pluginAssetError(
				"POLICY",
				"plugin download sha256 pin must be 64 lowercase hex characters",
			)
		}
		return { url: deps.downloader.vetUrl(request.url), dest: request.dest }
	}

	async function requestDownload(
		pluginId: string,
		request: PluginDownloadRequest,
	): Promise<PluginDownloadResult> {
		const manifest = assertPluginAllowed(pluginId)
		const { url, dest } = validateRequest(request)
		if (deps.readOnly) {
			throw pluginAssetError(
				"UNAVAILABLE",
				"plugin downloads are unavailable while viewing a read-only archive",
			)
		}

		return writeVersioned(deps.paths, deps.readOnly, async (latest) => {
			const vaultDir = latest.pluginVaultDir(pluginId)
			// Dest confinement happens before any network: a bad path can
			// never produce a request at all.
			return asPolicy(async () => {
				const parsed = parsePluginVaultDest(vaultDir, dest)
				const existing = await vaultStatFile(vaultDir, parsed.rel)
				if (existing !== undefined) {
					const existingSha256 = await vaultFileSha256(vaultDir, parsed.rel)
					// A cached hit still honours an integrity pin: a file
					// that no longer matches the requested digest is a
					// stale cache miss, not a silent "already present".
					if (
						request.sha256 !== undefined &&
						existingSha256 !== request.sha256
					) {
						throw pluginAssetError(
							"POLICY",
							`plugin vault file "${parsed.rel}" fails the requested sha256 pin`,
						)
					}
					return {
						path: parsed.rel,
						sizeBytes: existing.sizeBytes,
						sha256: existingSha256,
						cached: true,
					}
				}

				const decision = await deps.consent.request({
					pluginId,
					pluginName: manifest.name,
					url,
					dest: parsed.rel,
					reason: request.reason,
				})
				if (!decision.approved) {
					throw pluginAssetError(
						"DENIED",
						"plugin download was declined (or the consent dialog timed out)",
					)
				}

				const tempPath = vaultTempFile(vaultDir)
				try {
					await mkdir(vaultDir, { recursive: true })
					const fetched = await deps.downloader.fetchToFile(url, tempPath)
					if (
						request.sha256 !== undefined &&
						fetched.sha256 !== request.sha256
					) {
						throw pluginAssetError(
							"POLICY",
							`plugin download integrity mismatch: expected ${request.sha256}, got ${fetched.sha256}`,
						)
					}
					const committed = await commitVaultFile({
						vaultDir,
						rel: parsed.rel,
						tempPath,
						maxFileBytes: deps.maxFileBytes,
						maxTotalBytes: deps.maxTotalBytes,
					})
					return {
						path: parsed.rel,
						sizeBytes: committed.sizeBytes,
						sha256: committed.sha256,
						cached: false,
					}
				} finally {
					await discardVaultTempFile(tempPath)
				}
			})
		})
	}

	async function statAsset(
		pluginId: string,
		path: string,
	): Promise<{ readonly sizeBytes: number } | undefined> {
		assertPluginAllowed(pluginId)
		const vaultDir = deps.paths
			.atVersion(deps.paths.activeVersion)
			.pluginVaultDir(pluginId)
		return asPolicy(() => vaultStatFile(vaultDir, path))
	}

	async function readAsset(
		pluginId: string,
		path: string,
	): Promise<Uint8Array> {
		assertPluginAllowed(pluginId)
		const vaultDir = deps.paths
			.atVersion(deps.paths.activeVersion)
			.pluginVaultDir(pluginId)
		return asPolicy(() => vaultReadFile(vaultDir, path, deps.maxReadAssetBytes))
	}

	async function deleteAsset(
		pluginId: string,
		path: string,
	): Promise<PluginAssetDeleteResult> {
		assertPluginAllowed(pluginId)
		if (deps.readOnly) {
			throw pluginAssetError(
				"UNAVAILABLE",
				"plugin vault deletes are unavailable while viewing a read-only archive",
			)
		}
		return writeVersioned(deps.paths, deps.readOnly, async (latest) => {
			const vaultDir = latest.pluginVaultDir(pluginId)
			return { existed: await asPolicy(() => vaultRemoveFile(vaultDir, path)) }
		})
	}

	return { requestDownload, statAsset, readAsset, deleteAsset }
}
