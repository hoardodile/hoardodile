import { readFileSync } from "node:fs"
import { rm } from "node:fs/promises"
import { join } from "node:path"
import {
	createPluginHooks,
	createPluginLoader,
	createPluginSandbox,
	DEFAULT_SANDBOX_CONFIG,
	seedPlugins,
} from "@hoardodile/host"
import { assertSafeSegment, writeVersioned } from "@hoardodile/host/hoard"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import "src/infra/fastify-augment.ts"
import { isPackagedRuntime } from "src/config/env.ts"
import { createPluginService } from "./service.ts"
import { createPluginSettingsStore } from "./settings-store.ts"

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

	const sandbox = createPluginSandbox({
		...DEFAULT_SANDBOX_CONFIG,
		watchdogMs: app.env.PLUGIN_WATCHDOG_TIMEOUT_MS,
		hardTimeoutMs: app.env.PLUGIN_HOOK_HARD_TIMEOUT_MS,
		maxOldSpaceMb: app.env.PLUGIN_WORKER_MAX_OLD_SPACE_MB,
	})
	app.addHook("onClose", async () => {
		await sandbox.disposeAll()
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
		// On a packaged runtime the bundled official plugins live in the
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
