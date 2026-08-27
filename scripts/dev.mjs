import { execSync, spawn } from "node:child_process"
import { existsSync, readFileSync, statSync } from "node:fs"
import { basename, join, resolve } from "node:path"
import process from "node:process"
import { readPluginId } from "./lib/plugin-channels.mjs"
import { killTree } from "./lib/process.mjs"
import { WORKSPACE_ROOT } from "./lib/workspace.mjs"

// Load a local `.env` file into process.env so `pnpm dev` can be driven by
// env vars without exporting them manually. Safe to call even when no .env
// exists; in that case we fall back to the defaults below.
try {
	process.loadEnvFile(resolve(WORKSPACE_ROOT, ".env"))
} catch {
	// no .env present
}

const devPorts = JSON.parse(
	readFileSync(new URL("./lib/dev-ports.json", import.meta.url), "utf8"),
)

/**
 * Resolve a DEV_PLUGINS entry to a plugin directory (absolute, or
 * relative to the workspace root). The directory must contain a
 * manifest.json. Returns undefined when the entry is not a usable plugin
 * directory.
 */
function pluginFromPath(entry) {
	const dirPath = resolve(WORKSPACE_ROOT, entry)
	if (!existsSync(dirPath) || !statSync(dirPath).isDirectory()) return undefined
	const manifestPath = join(dirPath, "manifest.json")
	if (!existsSync(manifestPath)) return undefined
	try {
		const manifest = JSON.parse(readFileSync(manifestPath, "utf-8"))
		let hasWatch = false
		const pkgPath = join(dirPath, "package.json")
		if (existsSync(pkgPath)) {
			const pkg = JSON.parse(readFileSync(pkgPath, "utf-8"))
			hasWatch = typeof pkg.scripts?.watch === "string"
		}
		return {
			name: basename(dirPath),
			label: manifest.name ?? basename(dirPath),
			dirPath,
			distPath: join(dirPath, "dist"),
			hasWatch,
		}
	} catch {
		return undefined
	}
}

function selectPlugins() {
	const raw = process.env.DEV_PLUGINS
	if (raw === undefined || raw.length === 0) {
		console.log("[dev] DEV_PLUGINS not set, starting without plugin watches.")
		return []
	}

	const selected = []
	for (const entry of raw
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0)) {
		const plugin = pluginFromPath(entry)
		if (plugin !== undefined) {
			selected.push(plugin)
		} else {
			console.warn(`[dev] unknown plugin directory: ${entry}`)
		}
	}
	return selected
}

function buildServices(selectedPlugins) {
	const svcs = []

	// The web runs on the vite dev server (HMR), proxying /trpc, /auth,
	// /health and /api to the backend (apps/web/vite.config.ts). Workspace
	// packages resolve to source through their `development` export
	// condition, so package edits hot-reload too — no builds in the loop.
	// Mirror of the server default (apps/server/src/config/env.ts); the
	// single source for dev tooling is scripts/lib/dev-ports.json.
	const serverPort = process.env.PORT ?? String(devPorts.api)
	const bindHost = process.env.HOST
	const hostFlag =
		bindHost !== undefined &&
		bindHost !== "localhost" &&
		bindHost !== "127.0.0.1"
			? ` --host ${bindHost}`
			: ""
	svcs.push({
		name: "web",
		command: `pnpm -F @hoardodile/web dev${hostFlag}`,
		env: { VITE_SERVER_URL: `http://127.0.0.1:${serverPort}` },
	})

	for (const pl of selectedPlugins) {
		if (!pl.hasWatch) {
			console.log(
				`[dev] ${pl.name}: no watch script found, loading ${pl.distPath} without a watcher.`,
			)
			continue
		}
		svcs.push({
			name: `plugin:${pl.name}`,
			command: `pnpm --dir "${pl.dirPath}" watch`,
		})
	}

	// file is the fallback builtin; only it should use BUILTIN_PATH
	const filePlugin = selectedPlugins.find((p) => p.name === "file")
	const devPlugins = selectedPlugins.filter((p) => p.name !== "file")

	// Extra dist directories from the environment are appended to the mapping:
	// the server loads them as-is, but no watcher is started for them.
	const extraDevPaths = (process.env.DEV_PLUGIN_PATHS ?? "")
		.split(",")
		.map((s) => s.trim())
		.filter((s) => s.length > 0)
	let devPluginPaths = dedupePluginDirsById([
		...new Set([...devPlugins.map((pl) => pl.distPath), ...extraDevPaths]),
	])

	// The seed channel wins over dev paths: when a plugin's dist is ALSO
	// listed in an explicitly configured SEED_PLUGIN_PATHS, it loads as an
	// installed seed instead of a dev plugin — a dev plugin cannot be
	// uninstalled, and a seeded plugin must show the uninstall action. Its
	// watch script keeps rebuilding dist; a server restart refreshes the
	// seeded copy — unless the plugin was deliberately uninstalled, which
	// the removal marker keeps out until it is restored from the
	// marketplace's bundled-plugins section.
	const explicitSeeds = process.env.SEED_PLUGIN_PATHS
	if (explicitSeeds !== undefined && explicitSeeds.trim().length > 0) {
		const seedIds = new Set()
		for (const dir of explicitSeeds
			.split(",")
			.map((s) => s.trim())
			.filter((s) => s.length > 0)) {
			const id = readPluginId(dir)
			if (id !== undefined) seedIds.add(id)
		}
		if (seedIds.size > 0) {
			devPluginPaths = devPluginPaths.filter((dir) => {
				const id = readPluginId(dir)
				return id === undefined || !seedIds.has(id)
			})
		}
	}

	const serverEnv = {
		STORAGE_ROOT:
			process.env.STORAGE_ROOT ?? resolve(WORKSPACE_ROOT, "tmp", "dev-storage"),
		HOST: process.env.HOST ?? "0.0.0.0",
		APP_WEB_ROOT:
			process.env.APP_WEB_ROOT ??
			resolve(WORKSPACE_ROOT, "apps", "web", "dist"),
		BUILTIN_PATH:
			process.env.BUILTIN_PATH ??
			(filePlugin !== undefined
				? filePlugin.distPath
				: resolve(WORKSPACE_ROOT, "plugins", "file", "dist")),
		DEV_PLUGIN_PATHS: devPluginPaths.join(","),
		// Seed the selected plugins' dists into versions/<latest>/plugins
		// on every server start so they behave like installed plugins.
		// file stays out: it is the builtin, served from BUILTIN_PATH.
		SEED_PLUGIN_PATHS:
			process.env.SEED_PLUGIN_PATHS ?? devPluginPaths.join(","),
	}

	svcs.push({
		name: "server",
		command: "pnpm -F @hoardodile/server dev",
		env: serverEnv,
	})

	return svcs
}

/**
 * Drop duplicate plugin directories by manifest id. Two different
 * directories carrying the same id (e.g. a plugin source dir and its
 * dist, or a stale extra path) would make the server activate the id
 * twice — the first worker gets replaced, and the registry is left
 * pointing at a disposed sandbox (every hook fails with "sandbox
 * disposed"). Later entries win, mirroring the server's own dedupe.
 */
function dedupePluginDirsById(dirs) {
	const byId = new Map()
	const out = []
	for (const dir of dirs) {
		let id
		try {
			id = JSON.parse(readFileSync(join(dir, "manifest.json"), "utf-8")).id
		} catch {
			// Not a readable plugin dir — keep it as-is.
			out.push(dir)
			continue
		}
		if (typeof id !== "string" || id.length === 0) {
			out.push(dir)
			continue
		}
		const previous = byId.get(id)
		if (previous !== undefined) {
			console.warn(
				`[dev] ${dir} and ${previous} share plugin id ${id} — keeping ${dir}, dropping ${previous}`,
			)
			const index = out.indexOf(previous)
			if (index !== -1) out.splice(index, 1)
		}
		byId.set(id, dir)
		out.push(dir)
	}
	return out
}

function showHelp() {
	const HELP = [
		"dev — start development services",
		"",
		"Usage:",
		"  pnpm dev",
		"  DEV_PLUGINS=C:/path/to/plugin-a,C:/path/to/plugin-b pnpm dev",
		"",
		"Environment:",
		"  DEV_PLUGINS          Comma-separated plugin directories to develop (absolute, or",
		"                       relative to the repo root). Each must contain a manifest.json;",
		"                       its `watch` script runs when present. No watches without this.",
		"  DEV_PLUGIN_PATHS     Extra dev plugin dist directories, appended to the DEV_PLUGINS",
		"                       mapping (loaded by the server as-is, no watcher started).",
		"  SEED_PLUGIN_PATHS    Plugin dist directories (absolute, or relative to the repo root)",
		"                       seeded into versions/<latest>/plugins on server start, so",
		"                       they behave like installed plugins (defaults to the DEV_PLUGINS",
		"                       selection's dists).",
		"  STORAGE_ROOT         Storage root for the dev server.",
		"  HOST                 Bind host for the dev server (also passed to the web dev server",
		"                       so LAN access keeps working).",
		"  PORT                 Port for the dev server; the web dev server proxies to it.",
		"  APP_WEB_ROOT         Pre-built web assets directory (only relevant when opening the",
		"                       server port directly; the dev flow uses the vite dev server).",
		"  BUILTIN_PATH         Builtin plugin directory (default: plugins/file/dist).",
	].join("\n")
	console.log(HELP)
}

async function main() {
	if (process.argv.includes("--help") || process.argv.includes("-h")) {
		showHelp()
		return
	}

	const selected = selectPlugins()

	// Workspace packages resolve to source in dev via their `development`
	// export condition, so the app itself needs no builds. The plugin
	// toolchain is the one exception: `hoardodile plugin build` bundles the
	// SDK from dist and the CLI bin loads its own dist. Building the builtin
	// file plugin pulls in exactly that closure (cli, ui, sdk-*, host) —
	// turbo-cached, so this is fast and skips to no-ops when warm.
	console.log("[dev] building plugin toolchain closure (turbo-cached)...")
	execSync("pnpm exec turbo run build --filter=@hoardodile/plugin-file", {
		stdio: "inherit",
	})

	const services = buildServices(selected)
	const children = []
	let exiting = false

	function cleanup(exitCode = 0) {
		if (exiting) return
		exiting = true
		console.log("\n[dev] stopping services...")
		for (const child of children) {
			if (child.exitCode !== null) continue
			killTree(child.pid)
		}
		process.exit(exitCode)
	}

	process.on("SIGINT", () => cleanup(0))
	process.on("SIGTERM", () => cleanup(0))

	for (const svc of services) {
		console.log(`[dev] starting ${svc.name}...`)
		// Spawn a single command string through the shell: passing an args
		// array with `shell: true` triggers Node's DEP0190 warning, and the
		// commands are static strings with no user input.
		const child = spawn(svc.command, {
			stdio: "inherit",
			shell: true,
			env: svc.env !== undefined ? { ...process.env, ...svc.env } : process.env,
		})
		child.on("error", (err) => {
			console.error(`[dev] ${svc.name} failed to start:`, err)
			cleanup(1)
		})
		child.on("exit", (code) => {
			if (code !== 0 && code !== null) {
				console.error(`[dev] ${svc.name} exited with code ${code}`)
				cleanup(code)
			} else if (code === 0) {
				console.log(`[dev] ${svc.name} exited cleanly`)
				cleanup(0)
			}
		})
		children.push(child)
		await new Promise((resolve) => setTimeout(resolve, 3000))
	}

	console.log(
		"[dev] all services started (web URL is in the vite output above). Ctrl+C to stop.",
	)
}

main().catch((err) => {
	console.error(err)
	process.exit(1)
})
