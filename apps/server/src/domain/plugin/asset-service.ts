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
import { join } from "node:path"
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
	vaultTotalSize,
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
	PLUGIN_ASSET_BATCH_MAX_ITEMS,
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
		options?: { readonly expectsClient?: boolean },
	) => Promise<PluginDownloadResult>
	readonly requestDownloads: (
		pluginId: string,
		requests: readonly PluginDownloadRequest[],
		options?: { readonly expectsClient?: boolean },
	) => Promise<readonly PluginDownloadResult[]>
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
		options?: { readonly expectsClient?: boolean },
	): Promise<PluginDownloadResult> {
		const results = await requestDownloads(pluginId, [request], options)
		return results[0]!
	}

	/**
	 * Batch download: one user-consent question for the whole set,
	 * all-or-nothing. Order of business (per item): registry + permission
	 * check → request validation (URL policy, dest confinement — before
	 * any network) → vault stat (cached files resolve silently) → ONE
	 * consent ticket for the misses (or session remember) → streamed
	 * downloads with caps and SRI-style sha256 verification → cumulative
	 * quota pre-check → atomic commits in request order. Any failure
	 * discards every staged file: nothing is partially committed.
	 */
	async function requestDownloads(
		pluginId: string,
		requests: readonly PluginDownloadRequest[],
		options?: { readonly expectsClient?: boolean },
	): Promise<readonly PluginDownloadResult[]> {
		const manifest = assertPluginAllowed(pluginId)
		if (requests.length === 0) {
			throw pluginAssetError(
				"POLICY",
				"plugin download batch must contain at least one request",
			)
		}
		if (requests.length > PLUGIN_ASSET_BATCH_MAX_ITEMS) {
			throw pluginAssetError(
				"POLICY",
				`plugin download batch exceeds ${PLUGIN_ASSET_BATCH_MAX_ITEMS} items`,
			)
		}
		if (deps.readOnly) {
			throw pluginAssetError(
				"UNAVAILABLE",
				"plugin downloads are unavailable while viewing a read-only archive",
			)
		}

		// Validate every URL/dest/sha256/reason BEFORE any consent or
		// network activity.
		const vetted = requests.map((request) => validateRequest(request))

		const sourceVersion = deps.paths.latestVersion
		return (async () => {
			const vaultDir = deps.paths.latest.pluginVaultDir(pluginId)
			// Dest confinement happens before any network: a bad path can
			// never produce a request at all.
			return asPolicy(async () => {
				type PlannedEntry = {
					readonly request: PluginDownloadRequest
					readonly parsed: { readonly rel: string }
					readonly cached:
						| { readonly sizeBytes: number; readonly sha256: string }
						| undefined
				}
				const seenDests = new Set<string>()
				const planned: PlannedEntry[] = []
				for (let i = 0; i < requests.length; i++) {
					const request = requests[i]!
					const parsed = parsePluginVaultDest(vaultDir, vetted[i]!.dest)
					if (seenDests.has(parsed.rel)) {
						throw pluginAssetError(
							"POLICY",
							`duplicate destination in plugin download batch: ${parsed.rel}`,
						)
					}
					seenDests.add(parsed.rel)
					const existing = await vaultStatFile(vaultDir, parsed.rel)
					if (existing === undefined) {
						planned.push({ request, parsed, cached: undefined })
						continue
					}
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
					planned.push({
						request,
						parsed,
						cached: { sizeBytes: existing.sizeBytes, sha256: existingSha256 },
					})
				}
				const misses = planned.filter((p) => p.cached === undefined)

				if (misses.length > 0) {
					const decision = await deps.consent.request(
						{
							pluginId,
							pluginName: manifest.name,
							items: misses.map((p) => ({
								url: p.request.url,
								dest: p.parsed.rel,
								reason: p.request.reason,
							})),
						},
						options,
					)
					if (!decision.approved) {
						throw pluginAssetError(
							"DENIED",
							"plugin download was declined (or the consent dialog timed out)",
						)
					}
				}

				// Stage every miss, verify each pin, then commit all — a
				// failure anywhere discards every staging file.
				type StagedEntry = {
					readonly planned: PlannedEntry
					readonly tempPath: string
					readonly sizeBytes: number
					readonly sha256: string
				}
				const staged: StagedEntry[] = []
				try {
					for (const entry of misses) {
						const stagingRoot = join(deps.paths.local.root, "vault-staging")
						const tempPath = vaultTempFile(stagingRoot)
						await mkdir(stagingRoot, { recursive: true })
						const fetched = await deps.downloader.fetchToFile(
							entry.request.url,
							tempPath,
						)
						if (
							entry.request.sha256 !== undefined &&
							fetched.sha256 !== entry.request.sha256
						) {
							throw pluginAssetError(
								"POLICY",
								`plugin download integrity mismatch: expected ${entry.request.sha256}, got ${fetched.sha256}`,
							)
						}
						staged.push({
							planned: entry,
							tempPath,
							sizeBytes: fetched.sizeBytes,
							sha256: fetched.sha256,
						})
					}
					// `commitVaultFile` checks the total quota per commit
					// against the vault's current size, so a sequential
					// commit could fail mid-batch and leave a partial
					// result — pre-check the cumulative sum once.
					await writeVersioned(deps.paths, deps.readOnly, async () => {
						if (deps.readOnly || deps.paths.latestVersion !== sourceVersion) {
							throw pluginAssetError(
								"UNAVAILABLE",
								"The archive changed while the download was pending",
							)
						}
						assertPluginAllowed(pluginId)
						const currentTotal = await vaultTotalSize(vaultDir)
						const addedBytes = staged.reduce((sum, s) => sum + s.sizeBytes, 0)
						if (currentTotal + addedBytes > deps.maxTotalBytes) {
							throw pluginAssetError(
								"POLICY",
								`plugin download batch would exceed the ${deps.maxTotalBytes}-byte plugin quota (current ${currentTotal})`,
							)
						}
						for (const entry of staged) {
							await commitVaultFile({
								vaultDir,
								rel: entry.planned.parsed.rel,
								tempPath: entry.tempPath,
								maxFileBytes: deps.maxFileBytes,
								maxTotalBytes: deps.maxTotalBytes,
							})
						}
					})
				} finally {
					for (const entry of staged) {
						await discardVaultTempFile(entry.tempPath)
					}
				}

				// Results in request order; cached hits keep their slots.
				let stagedIndex = 0
				return planned.map((entry) => {
					if (entry.cached !== undefined) {
						return {
							path: entry.parsed.rel,
							sizeBytes: entry.cached.sizeBytes,
							sha256: entry.cached.sha256,
							cached: true,
						}
					}
					const committed = staged[stagedIndex++]!
					return {
						path: entry.parsed.rel,
						sizeBytes: committed.sizeBytes,
						sha256: committed.sha256,
						cached: false,
					}
				})
			})
		})()
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

	return {
		requestDownload,
		requestDownloads,
		statAsset,
		readAsset,
		deleteAsset,
	}
}
