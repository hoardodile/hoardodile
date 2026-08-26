import { existsSync, readFileSync } from "node:fs"
import { mkdir, rm } from "node:fs/promises"
import { join } from "node:path"
import type { PluginAssetHandler } from "@hoardodile/host"
import {
	createPluginHooks,
	createPluginLoader,
	createPluginSandbox,
	DEFAULT_SANDBOX_CONFIG,
	seedPlugins,
} from "@hoardodile/host"
import {
	assertSafeSegment,
	extractArchiveInto,
	writeVersioned,
} from "@hoardodile/host/hoard"
import { PLUGIN_READ_FILE_MAX_BYTES } from "@hoardodile/sdk-types/plugin"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import "src/infra/fastify-augment.ts"
import { isPackagedRuntime } from "src/config/env.ts"
import { createPluginAssetService } from "./asset-service.ts"
import { createConsentBroker } from "./consent.ts"
import { createPluginDownloader } from "./downloader.ts"
import { createPluginService } from "./service.ts"
import { createPluginSettingsStore } from "./settings-store.ts"
import { buildPluginUploads, moveDir } from "./upload.ts"

async function pluginDomainImpl(app: FastifyInstance): Promise<void> {
	const builtinDir = app.env.BUILTIN_PATH
	if (builtinDir === undefined && app.env.NODE_ENV !== "test") {
		throw new Error("Builtin plugin path is required: set BUILTIN_PATH env.")
	}

	const viewingPluginsDir = app.paths
		.atVersion(app.paths.activeVersion)
		.plugins()

	async function preparePluginDisk(): Promise<void> {
		if (app.readOnly) return
		await writeVersioned(app.paths, false, (latest) => {
			seedPlugins(latest.plugins(), app.env.SEED_PLUGIN_PATHS)
		})
	}

	await preparePluginDisk()

	// The consent broker is the single authorization gate for every
	// download: tickets broadcast over SSE, answers arrive through tRPC,
	// every resolution is broadcast so all tabs close their dialogs.
	const consent = createConsentBroker({
		timeoutMs: app.env.PLUGIN_DOWNLOAD_CONSENT_TIMEOUT_MS,
		onRequest: (ticket) => {
			app.sseBroadcaster.broadcast({
				type: "pluginDownloadRequested",
				ticketId: ticket.ticketId,
				pluginId: ticket.pluginId,
				pluginName: ticket.pluginName,
				items: ticket.items,
			})
		},
		onResolved: (ticketId) => {
			app.sseBroadcaster.broadcast({
				type: "pluginDownloadResolved",
				ticketId,
			})
		},
		connectionCount: () => app.sseBroadcaster.connectionCount(),
	})

	const downloader = createPluginDownloader({
		maxBytes: app.env.PLUGIN_DOWNLOAD_MAX_BYTES,
		timeoutMs: 60_000,
		allowPrivate: app.env.PLUGIN_DOWNLOAD_ALLOW_PRIVATE,
	})
	app.decorate("pluginDownloader", downloader)

	// One upload pipeline serves both the browser's zip upload and the
	// marketplace's URL install — the commit step (writeVersioned + vault
	// preservation) must be identical for local and remote installs.
	const uploads = buildPluginUploads({
		stagingRoot: app.paths.local.uploadStagingRoot(),
		commit: async (stagingDir, id) => {
			await writeVersioned(app.paths, app.readOnly, async (latest) => {
				const destDir = join(latest.plugins(), assertSafeSegment(id))
				await mkdir(latest.plugins(), { recursive: true })
				// The host-managed vault survives a plugin update: move it
				// aside (host-local staging), swap the tree, move it back.
				// A crash in between strands the vault in the staging root,
				// which startup cleanup reclaims — the plugin re-fetches.
				const vaultDir = join(destDir, "vault")
				const stashDir = join(
					app.paths.local.uploadStagingRoot(),
					`plugin-vault-${id}-${Date.now()}`,
				)
				const hasVault = existsSync(vaultDir)
				if (hasVault) {
					await moveDir(vaultDir, stashDir)
				}
				if (existsSync(destDir)) {
					await rm(destDir, { recursive: true, force: true })
				}
				await moveDir(stagingDir, destDir)
				if (existsSync(stashDir)) {
					await moveDir(stashDir, join(destDir, "vault"))
				}
			})
		},
		extractArchive: extractArchiveInto,
		maxExtractedBytes: app.env.PLUGIN_UPLOAD_MAX_BYTES,
	})
	app.decorate("pluginUploads", uploads)

	// The asset service is referenced through closures only — invoked at
	// hook/tRPC time, long after `loader` initialized below.
	const assetService = createPluginAssetService({
		paths: app.paths,
		readOnly: app.readOnly,
		getPlugin: (pluginId) => {
			const entry = app.pluginLoader.getRegistry().getById(pluginId)
			if (entry === undefined) return undefined
			return {
				manifest: entry.manifest,
				enabled: entry.enabled,
				missing: entry.missing,
			}
		},
		consent,
		downloader,
		maxFileBytes: app.env.PLUGIN_DOWNLOAD_MAX_BYTES,
		maxTotalBytes: app.env.PLUGIN_DOWNLOAD_MAX_TOTAL_BYTES,
		maxReadAssetBytes: PLUGIN_READ_FILE_MAX_BYTES,
	})

	const assetHandler: PluginAssetHandler = {
		download: (pluginId, request) =>
			assetService.requestDownloads(
				pluginId,
				Array.isArray(request) ? request : [request],
			),
		statAsset: (pluginId, path) => assetService.statAsset(pluginId, path),
		readAsset: (pluginId, path) => assetService.readAsset(pluginId, path),
		deleteAsset: (pluginId, path) => assetService.deleteAsset(pluginId, path),
	}

	const sandbox = createPluginSandbox({
		...DEFAULT_SANDBOX_CONFIG,
		watchdogMs: app.env.PLUGIN_WATCHDOG_TIMEOUT_MS,
		hardTimeoutMs: app.env.PLUGIN_HOOK_HARD_TIMEOUT_MS,
		maxOldSpaceMb: app.env.PLUGIN_WORKER_MAX_OLD_SPACE_MB,
		// Downloaded runtimes are importable from the sandbox: the vault
		// matches what the plugin actually sees (its own active version),
		// so dev plugins — whose vault lives outside their dev directory —
		// behave identically to installed ones.
		assetVaultDir: (pluginId) =>
			app.paths.atVersion(app.paths.activeVersion).pluginVaultDir(pluginId),
		pluginAssets: assetHandler,
	})
	app.addHook("onClose", async () => {
		await sandbox.disposeAll()
		consent.dispose()
	})

	const loader = createPluginLoader({
		builtinDir,
		devPluginDirs: app.readOnly ? [] : app.env.DEV_PLUGIN_PATHS,
		seedPluginDirs: [],
		pluginsDir: viewingPluginsDir,
		settings: createPluginSettingsStore(app.db),
		disableDevPlugins: app.env.DISABLE_DEV_PLUGINS,
		sandbox,
		onTiming: (step, ms) => {
			app.log.info({ step, ms }, "content plugin boot step finished")
		},
	})
	await loader.loadAll()
	app.decorate("pluginLoader", loader)
	const pluginService = createPluginService({
		db: app.db,
		loader,
		sandbox,
		readOnly: app.readOnly,
		prepareDisk: preparePluginDisk,
		removeInstalledDir: async (id) => {
			await writeVersioned(app.paths, app.readOnly, async (latest) => {
				await rm(join(latest.plugins(), assertSafeSegment(id)), {
					recursive: true,
					force: true,
				})
			})
		},
		// On a packaged runtime the bundled seed plugins live in the
		// SEED_PLUGIN_PATHS directories themselves — removing a plugin also
		// removes its bundled source, so a restart cannot resurrect it
		// (until an app update re-ships the package). Plain servers keep
		// the admin's seed sources untouched and re-import on restart.
		removeSeedSource: async (id) => {
			if (!isPackagedRuntime()) return
			for (const dir of app.env.SEED_PLUGIN_PATHS) {
				try {
					const manifest = JSON.parse(
						readFileSync(join(dir, "manifest.json"), "utf-8"),
					) as { id?: unknown }
					if (manifest.id === id) {
						await rm(dir, { recursive: true, force: true })
					}
				} catch {
					// Not a seed source for this id (or unreadable) — skip.
				}
			}
		},
	})
	// Record every discovered plugin so a later disk removal shows up in
	// the missing list instead of leaving bound resources as "unknown".
	pluginService.syncRecords()
	app.decorate("pluginService", pluginService)
	app.decorate("pluginAssetService", assetService)
	app.decorate("pluginAssetConsent", consent)
	// The hook facade reads the registry through a live accessor, so
	// consumers never hold a stale registry across a rescan.
	app.decorate(
		"pluginHooks",
		createPluginHooks({ getRegistry: () => loader.getRegistry() }),
	)
}

export const pluginDomain = fp(pluginDomainImpl satisfies FastifyPluginAsync, {
	name: "content-plugin-domain",
	dependencies: ["db-plugin", "paths-plugin"],
})
