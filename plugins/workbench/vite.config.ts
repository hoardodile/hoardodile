import { readFileSync } from "node:fs"
import { resolve } from "node:path"
import type { Connect, Plugin } from "vite"
import { defineConfig } from "vite"
// The dev server and the published standalone server share one routing
// module, so a route can never exist in only one of them.
import {
	createDirectoryProviders,
	createWorkbenchMounts,
} from "./scripts/mounts.mjs"

const pluginDir = process.env.WORKBENCH_PLUGIN_DIR
const dataDir = process.env.WORKBENCH_DATA_DIR
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
			if (dataDir === undefined) {
				console.warn("[workbench] WORKBENCH_DATA_DIR not set — no data mounted")
			}
			const providers = {
				...(dataDir === undefined
					? { resources: () => [] }
					: createDirectoryProviders(dataDir)),
				...(snapshotFile === undefined
					? {}
					: { snapshot: fileSnapshot(snapshotFile) }),
			}
			const mounts = createWorkbenchMounts({ pluginDir, providers })
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
	plugins: [workbenchMountsPlugin()],
	server: {
		port: 5199,
		strictPort: true,
	},
})
