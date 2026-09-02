import { readFileSync } from "node:fs"
import { join, resolve } from "node:path"
import babel from "@rolldown/plugin-babel"
import tailwindcss from "@tailwindcss/vite"
import react, { reactCompilerPreset } from "@vitejs/plugin-react"
import type { Connect, Plugin } from "vite"
import { defineConfig } from "vite"
// The dev server and the published standalone server share one routing
// module, so a route can never exist in only one of them.
import {
	createDirectoryProviders,
	createRebuildBus,
	createResourceDirProviders,
	createWorkbenchMounts,
} from "./scripts/mounts.mjs"

const pluginDir = process.env.WORKBENCH_PLUGIN_DIR
const dataDir = process.env.WORKBENCH_DATA_DIR
const resourceDir = process.env.WORKBENCH_RESOURCE_DIR
const snapshotFile = process.env.WORKBENCH_SNAPSHOT_FILE

/**
 * Read the hook snapshot from disk on every request, so a watch-driven
 * recapture lands without a restart. The published server takes a
 * provider function instead; both keep the workbench free of any
 * sandbox dependency.
 */
function fileSnapshot(filePath: string) {
	const abs = resolve(filePath)
	return () => {
		try {
			return JSON.parse(readFileSync(abs, "utf8"))
		} catch {
			return undefined
		}
	}
}

function workbenchMountsPlugin(): Plugin {
	return {
		name: "workbench-mounts",
		configureServer(server) {
			if (pluginDir === undefined) {
				console.warn(
					"[workbench] WORKBENCH_PLUGIN_DIR not set — no plugin bundle mounted",
				)
			}
			if (dataDir === undefined && resourceDir === undefined) {
				console.warn("[workbench] WORKBENCH_DATA_DIR not set — no data mounted")
			}
			const providers = {
				...(dataDir !== undefined
					? createDirectoryProviders(dataDir)
					: resourceDir !== undefined
						? createResourceDirProviders(resourceDir)
						: { resources: () => [] }),
				...(snapshotFile === undefined
					? {}
					: { snapshot: fileSnapshot(snapshotFile) }),
			}
			const mounts = createWorkbenchMounts({
				pluginDir,
				providers,
				// Idle bus: the workbench's own dev server does not watch a
				// plugin build for rebuilds, but registering the SSE route
				// keeps the page from error-looping on a missing endpoint.
				rebuildBus: createRebuildBus(),
				// The dev vault lives with the plugin's other workbench
				// scratch (`.hoardodile/extract`): user-consented dev
				// downloads never touch the data or storage root.
				vault:
					pluginDir === undefined
						? undefined
						: join(pluginDir, ".hoardodile", "vault"),
			})
			const middleware: Connect.NextHandleFunction = (req, res, next) => {
				void (async () => {
					for (const mount of mounts) {
						if (await mount(req, res)) return
					}
					next()
				})()
			}
			server.middlewares.use(middleware)
		},
	}
}

export default defineConfig({
	plugins: [
		react(),
		babel({ presets: [reactCompilerPreset()] }),
		tailwindcss(),
		workbenchMountsPlugin(),
	],
	server: {
		// Same bind as serveWorkbench/serve.mjs: the documented URL is
		// http://127.0.0.1:5199 (vite 8 would default to ::1 only). Not
		// strict: if 5199 is taken, vite rebinds to the next free port and
		// prints it, so a stale workbench never aborts the dev server.
		host: "127.0.0.1",
		port: 5199,
		strictPort: false,
	},
	build: {
		chunkSizeWarningLimit: Infinity,
	},
})
