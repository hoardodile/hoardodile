import { existsSync, readdirSync } from "node:fs"
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

/**
 * Discover the seed plugins that ship next to the app: every one-level
 * subdirectory carrying a `manifest.json` (packaged layout), or its `dist`
 * subdirectory (workspace layout). The shell never names which plugins
 * exist — whatever is bundled becomes a seed. `file` is the builtin
 * fallback (wired through BUILTIN_PATH, never seeded) and `template` the
 * scaffolder scaffold; both are excluded — keep the exclusion set in sync
 * with `scripts/lib/plugin-channels.mjs`.
 */
export function discoverSeedPluginDirs(
	pluginsRoot: string,
	distRel?: "dist",
): string[] {
	const out: string[] = []
	if (!existsSync(pluginsRoot)) return out
	for (const name of readdirSync(pluginsRoot, { withFileTypes: true })) {
		if (!name.isDirectory()) continue
		if (name.name === "file" || name.name === "template") continue
		const dir = join(pluginsRoot, name.name)
		const pluginDir = distRel === "dist" ? join(dir, distRel) : dir
		if (!existsSync(join(pluginDir, "manifest.json"))) continue
		out.push(pluginDir)
	}
	return out.sort()
}

export function packagedLayout(resourcesPath: string): SidecarLayout {
	const serverDir = join(resourcesPath, "server")
	const pluginsDir = join(resourcesPath, "plugins")
	return {
		packaged: true,
		nodePath: join(resourcesPath, "node", "node.exe"),
		serverArgs: ["--enable-source-maps", join(serverDir, "main.js")],
		cwd: serverDir,
		builtinPath: join(pluginsDir, "file"),
		seedPluginPaths: discoverSeedPluginDirs(pluginsDir),
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
		seedPluginPaths: discoverSeedPluginDirs(
			join(workspaceRoot, "plugins"),
			"dist",
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
