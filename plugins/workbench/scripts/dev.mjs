#!/usr/bin/env node
/**
 * Workbench dev server wrapper: `pnpm dev -- --plugin <dist-dir> --data <data-dir>`
 * (or `--resource-dir <dir>` for a folder whose direct subfolders are the
 * resources). Serves the plugin bundle under /plugin/ and the data
 * read-only under /data/ (see vite.config.ts); the page-side mock host
 * reads real files through the /data mount with no hoardodile server
 * involved.
 */
import { spawn } from "node:child_process"
import { existsSync, statSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"

const require = createRequire(import.meta.url)

function takeArg(name) {
	const idx = process.argv.indexOf(`--${name}`)
	if (idx === -1 || idx + 1 >= process.argv.length) return undefined
	return process.argv[idx + 1]
}

function requireDir(value, name) {
	if (value === undefined || value.length === 0) {
		throw new Error(`--${name} <dir> is required`)
	}
	const abs = resolve(value)
	if (!existsSync(abs) || !statSync(abs).isDirectory()) {
		throw new Error(`--${name} path is not a directory: ${abs}`)
	}
	return abs
}

const pluginDir = requireDir(takeArg("plugin"), "plugin")
const dataArg = takeArg("data")
const resourceArg = takeArg("resource-dir")
if (dataArg !== undefined && resourceArg !== undefined) {
	throw new Error("--data and --resource-dir are mutually exclusive")
}
const dataDir = dataArg !== undefined ? requireDir(dataArg, "data") : undefined
const resourceDir =
	resourceArg !== undefined
		? requireDir(resourceArg, "resource-dir")
		: undefined
if (dataDir === undefined && resourceDir === undefined) {
	throw new Error("--data <dir> or --resource-dir <dir> is required")
}

console.log(`[workbench] plugin: ${pluginDir}`)
if (dataDir !== undefined) console.log(`[workbench] data:   ${dataDir}`)
if (resourceDir !== undefined) console.log(`[workbench] resdir: ${resourceDir}`)

// Vite 8 no longer exports `./bin/vite.js` from its exports map; resolve
// the CLI through the package root instead.
const viteBin = join(
	dirname(require.resolve("vite/package.json")),
	"bin",
	"vite.js",
)
const child = spawn(process.execPath, [viteBin], {
	stdio: "inherit",
	env: {
		...process.env,
		WORKBENCH_PLUGIN_DIR: pluginDir,
		...(dataDir !== undefined ? { WORKBENCH_DATA_DIR: dataDir } : {}),
		...(resourceDir !== undefined
			? { WORKBENCH_RESOURCE_DIR: resourceDir }
			: {}),
	},
})
child.on("exit", (code) => process.exit(code ?? 0))
