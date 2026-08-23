import { existsSync } from "node:fs"
import { dirname, join } from "node:path"

export type SidecarLayout = {
	readonly packaged: boolean
	readonly nodePath: string
	readonly serverArgs: readonly string[]
	readonly cwd: string
	readonly builtinPath: string
	readonly seedPluginPaths: readonly string[]
	/**
	 * Prebuilt SPA dir served at `/` in dev (`apps/web/dist`), or
	 * `undefined` when it does not exist — the packaged server resolves
	 * its own bundled `web/` tree instead.
	 */
	readonly webRoot: string | undefined
}

const SEED_PLUGIN_IDS = ["gallery", "pdf"] as const

export function packagedLayout(resourcesPath: string): SidecarLayout {
	const serverDir = join(resourcesPath, "server")
	const pluginsDir = join(resourcesPath, "plugins")
	return {
		packaged: true,
		nodePath: join(resourcesPath, "node", "node.exe"),
		serverArgs: ["--enable-source-maps", join(serverDir, "main.js")],
		cwd: serverDir,
		builtinPath: join(pluginsDir, "file"),
		seedPluginPaths: SEED_PLUGIN_IDS.map((id) => join(pluginsDir, id)),
		webRoot: undefined,
	}
}

export function workspaceLayout(options: {
	readonly workspaceRoot: string
	readonly nodePath: string
	readonly viteNodeCli: string
}): SidecarLayout {
	const { workspaceRoot, nodePath, viteNodeCli } = options
	const serverRoot = join(workspaceRoot, "apps", "server")
	const webDist = join(workspaceRoot, "apps", "web", "dist")
	return {
		packaged: false,
		nodePath,
		serverArgs: [viteNodeCli, "src/main.ts"],
		cwd: serverRoot,
		builtinPath: join(workspaceRoot, "plugins", "file", "dist"),
		seedPluginPaths: SEED_PLUGIN_IDS.map((id) =>
			join(workspaceRoot, "plugins", id, "dist"),
		),
		webRoot: existsSync(join(webDist, "index.html")) ? webDist : undefined,
	}
}

export function findWorkspaceRoot(startDir: string): string {
	let current = startDir
	while (true) {
		if (existsSync(join(current, "pnpm-workspace.yaml"))) return current
		const parent = dirname(current)
		if (parent === current) {
			throw new Error(
				`Could not locate workspace root from ${startDir} (no pnpm-workspace.yaml)`,
			)
		}
		current = parent
	}
}
