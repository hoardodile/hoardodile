import { existsSync, readFileSync } from "node:fs"
import { cp, rm } from "node:fs/promises"
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
	withFileCommit,
	writeVersioned,
} from "@hoardodile/host/hoard"
import { PLUGIN_READ_FILE_MAX_BYTES } from "@hoardodile/sdk-types/plugin"
import {
	createProxyResolver,
	describeProxy,
	resolveProxyConfig,
} from "@hoardodile/shared/net-proxy"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import "src/infra/fastify-augment.ts"
import { createOutboundNetwork } from "src/infra/outbound-network.ts"
import { createPluginAssetService } from "./asset-service.ts"
import { createConsentBroker } from "./consent.ts"
import { createPluginDownloader } from "./downloader.ts"
import {
	installPluginTransaction,
	recoverPluginInstallations,
} from "./install-transaction.ts"
import { createSeedRemovalsStore } from "./seed-removals.ts"
import { createPluginService } from "./service.ts"
import { createPluginSettingsStore } from "./settings-store.ts"
import { buildPluginUploads } from "./upload.ts"

async function pluginDomainImpl(app: FastifyInstance): Promise<void> {
	if (!app.libraryMaintenance) await recoverPluginInstallations(app.paths)
	const builtinDir = app.env.BUILTIN_PATH
	if (builtinDir === undefined && app.env.NODE_ENV !== "test") {
		throw new Error("Builtin plugin path is required: set BUILTIN_PATH env.")
	}

	const builtinId = builtinDir ? readSeedManifestId(builtinDir) : undefined
	const restoredLibrary = () =>
		existsSync(join(app.paths.local.root, "protection", "last-restore.json"))
	function activeBuiltinDir(): string | undefined {
		if (!builtinId || (app.libraryMaintenance && app.readOnly)) return undefined
		const recorded = join(
			app.paths.atVersion(app.paths.activeVersion).plugins(),
			builtinId,
		)
		return existsSync(join(recorded, "manifest.json")) ? recorded : undefined
	}

	// Deliberately-uninstalled bundled plugins: seeding skips these ids so
	// a removal persists across restarts and app updates. The bundled
	// originals are never deleted — the marketplace's bundled section
	// restores them, fully offline.
	const seedRemovals = createSeedRemovalsStore(app.paths.local.seedRemovals())

	/** The seed dirs whose plugin was not deliberately removed. */
	function seedDirsToSeed(): string[] {
		const removed = seedRemovals.read()
		return app.env.SEED_PLUGIN_PATHS.filter((dir) => {
			const id = readSeedManifestId(dir)
			return (
				id !== undefined &&
				!removed.has(id) &&
				!existsSync(join(app.paths.latest.plugins(), id, "manifest.json"))
			)
		})
	}

	async function preparePluginDisk(): Promise<void> {
		if (app.readOnly || app.libraryMaintenance || restoredLibrary()) return
		await writeVersioned(app.paths, false, async (latest) => {
			if (
				builtinId &&
				builtinDir &&
				!existsSync(join(latest.plugins(), builtinId, "manifest.json"))
			) {
				await cp(builtinDir, join(latest.plugins(), builtinId), {
					recursive: true,
					preserveTimestamps: true,
				})
			}
			seedPlugins(latest.plugins(), seedDirsToSeed())
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

	// The app-wide outbound proxy: auto-detected (env vars, then the OS
	// system proxy) with an explicit HOARDODILE_PROXY override — one
	// resolution shared by every network service. Re-read on demand (with
	// a short cache) so a proxy enabled or changed after boot is picked
	// up by the next marketplace fetch / plugin download with no restart.
	const proxyResolver = createProxyResolver(() =>
		resolveProxyConfig(process.env, process.platform),
	)
	app.log.info({ proxy: describeProxy(proxyResolver()) }, "outbound proxy")

	const downloader = createPluginDownloader({
		maxBytes: app.env.PLUGIN_DOWNLOAD_MAX_BYTES,
		timeoutMs: 60_000,
		allowPrivate: app.env.PLUGIN_DOWNLOAD_ALLOW_PRIVATE,
		proxy: proxyResolver,
	})
	app.decorate("pluginDownloader", downloader)
	app.decorate(
		"outboundNetwork",
		createOutboundNetwork({
			config: proxyResolver,
			fetcher: downloader,
			tmpDir: app.paths.local.tmp(),
		}),
	)

	// One upload pipeline serves both the browser's zip upload and the
	// marketplace's URL install — the commit step (writeVersioned + vault
	// preservation) must be identical for local and remote installs.
	const uploads = buildPluginUploads({
		stagingRoot: app.paths.local.uploadStagingRoot(),
		commit: async (stagingDir, id) => {
			if (id === builtinId)
				throw new Error(
					"The application's fallback plugin cannot be replaced by an uploaded package",
				)
			await writeVersioned(app.paths, app.readOnly, async () => {
				await installPluginTransaction({
					paths: app.paths,
					pluginId: id,
					staging: stagingDir,
				})
				await loader.rescan()
				pluginService.syncRecords()
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
		get readOnly() {
			return app.readOnly
		},
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
	app.decorate("stopPluginWorkers", async () => {
		consent.dispose()
		await sandbox.disposeAll()
	})

	const loader = createPluginLoader({
		get builtinDir() {
			return activeBuiltinDir()
		},
		get devPluginDirs() {
			return app.readOnly ? [] : app.env.DEV_PLUGIN_PATHS
		},
		seedPluginDirs: [],
		get pluginsDir() {
			return app.libraryMaintenance && app.readOnly
				? join(app.paths.local.root, "maintenance-plugins")
				: app.paths.atVersion(app.paths.activeVersion).plugins()
		},
		settings: createPluginSettingsStore(app.db),
		disableDevPlugins: app.env.DISABLE_DEV_PLUGINS,
		sandbox,
		onTiming: (step, ms) => {
			app.log.info({ step, ms }, "content plugin boot step finished")
		},
	})
	await loader.loadAll()
	app.decorate("pluginLoader", loader)
	const rawPluginService = createPluginService({
		db: app.db,
		loader,
		sandbox,
		get readOnly() {
			return app.readOnly
		},
		prepareDisk: preparePluginDisk,
		removeInstalledDir: async (id) => {
			await writeVersioned(app.paths, app.readOnly, async (latest) => {
				await rm(join(latest.plugins(), assertSafeSegment(id)), {
					recursive: true,
					force: true,
				})
			})
		},
		// The bundled seed sources stay untouched on every runtime shape —
		// the removal marker (written by uninstall) keeps them uninstalled
		// across restarts until the user restores them.
		seedDirs: app.env.SEED_PLUGIN_PATHS,
		seedRemovals,
	})
	const pluginService = {
		...rawPluginService,
		rescan: withFileCommit(app.paths.root, rawPluginService.rescan),
		uninstall: withFileCommit(app.paths.root, rawPluginService.uninstall),
		restoreSeedPlugin: withFileCommit(
			app.paths.root,
			rawPluginService.restoreSeedPlugin,
		),
	}
	// Record every discovered plugin so a later disk removal shows up in
	// the missing list instead of leaving bound resources as "unknown".
	pluginService.syncRecords()
	app.decorate("pluginService", pluginService)
	app.decorate("pluginAssetService", assetService)
	app.decorate("pluginAssetConsent", consent)
	app.storageReloadHandlers?.push(async () => {
		consent.dispose()
		await sandbox.disposeAll()
		await loader.loadAll()
		pluginService.syncRecords()
	})
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

/** The manifest id of a seed-plugin directory, or undefined when unreadable. */
function readSeedManifestId(dir: string): string | undefined {
	try {
		const parsed = JSON.parse(
			readFileSync(join(dir, "manifest.json"), "utf-8"),
		) as { id?: unknown }
		return typeof parsed.id === "string" && parsed.id.length > 0
			? parsed.id
			: undefined
	} catch {
		return undefined
	}
}
