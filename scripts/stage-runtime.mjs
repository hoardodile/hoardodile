#!/usr/bin/env node
/**
 * Assemble the server runtime tree that travels with the app: the bundled
 * server dist (its native `node_modules` and the embedded SPA included)
 * plus the builtin `file` plugin and every seed plugin dist. Consumed by
 * desktop packaging (`extra-resources`) and by the Docker image.
 *
 * The seed set is discovered via scripts/lib/plugin-channels.mjs and
 * nothing here names a plugin, so new official plugins join every channel
 * without touching this file.
 *
 * Usage:
 *   node scripts/stage-runtime.mjs --out <dir> [--channels-env]
 *
 * `--channels-env` additionally writes `<out>/channels.env` with the
 * BUILTIN_PATH / SEED_PLUGIN_PATHS values the Docker container needs.
 * Paths are written RELATIVE (`plugins/file`, `plugins/<slug>,…`) on
 * purpose: the packaged runtime resolves relative plugin paths against
 * its cwd (the image sets WORKDIR=/app), which keeps the file correct no
 * matter where staging wrote the tree. The desktop shell computes the
 * same values at runtime from its own resources tree and never reads
 * this file.
 */

import { cpSync, existsSync, mkdirSync, writeFileSync } from "node:fs"
import { basename, dirname, join, resolve } from "node:path"
import { fileURLToPath, pathToFileURL } from "node:url"
import { assertCopiedMediaBins } from "../apps/server/scripts/assert-media-bins.mjs"
import { findSeedPluginDists } from "./lib/plugin-channels.mjs"

const scriptDir = dirname(fileURLToPath(import.meta.url))
const workspaceRoot = resolve(scriptDir, "..")

/**
 * Copy the server runtime tree into `outDir` (server/, plugins/file/,
 * plugins/<slug>/…). Returns the staged seed slugs.
 */
export function stageRuntime(options) {
	const outDir = options.outDir
	const serverDist = join(workspaceRoot, "apps", "server", "dist")
	if (!existsSync(join(serverDist, "main.js"))) {
		throw new Error(
			`missing server build at ${serverDist} (run \`pnpm build\` first)`,
		)
	}

	mkdirSync(outDir, { recursive: true })
	copyDir(serverDist, join(outDir, "server"))
	assertCopiedMediaBins(join(outDir, "server", "node_modules"))

	// The builtin fallback (file) is staged separately — it is the one
	// plugin that is never a seed, served through BUILTIN_PATH instead.
	copyDir(
		join(workspaceRoot, "plugins", "file", "dist"),
		join(outDir, "plugins", "file"),
	)

	const seedDists = findSeedPluginDists(workspaceRoot)
	if (seedDists.length === 0) {
		throw new Error("no seed plugin dists found under plugins/*/dist")
	}
	const slugs = []
	for (const dist of seedDists) {
		const slug = basename(dirname(dist))
		copyDir(dist, join(outDir, "plugins", slug))
		slugs.push(slug)
	}

	if (options.channelsEnv === true) {
		// Relative to the process cwd on purpose — see the file header.
		const channels = [
			"BUILTIN_PATH=plugins/file",
			`SEED_PLUGIN_PATHS=${slugs.map((slug) => `plugins/${slug}`).join(",")}`,
			"",
		].join("\n")
		writeFileSync(join(outDir, "channels.env"), channels, "utf8")
	}

	return slugs
}

function copyDir(src, dest) {
	if (!existsSync(src)) throw new Error(`missing ${src}`)
	mkdirSync(dirname(dest), { recursive: true })
	cpSync(src, dest, { recursive: true, dereference: true })
}

function isDirectRun() {
	if (process.argv[1] === undefined) return false
	return pathToFileURL(resolve(process.argv[1])).href === import.meta.url
}

if (isDirectRun()) {
	const args = parseArgs(process.argv.slice(2))
	if (args.out === undefined) {
		console.error(
			"usage: node scripts/stage-runtime.mjs --out <dir> [--channels-env]",
		)
		process.exit(1)
	}
	const slugs = stageRuntime({
		outDir: resolve(args.out),
		channelsEnv: args["channels-env"] === true,
	})
	console.log(
		`staged server runtime at ${resolve(args.out)} (${slugs.length} seed plugins: ${slugs.join(", ")})`,
	)
}

function parseArgs(argv) {
	const out = {}
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === "--channels-env") {
			out["channels-env"] = true
			continue
		}
		if (arg === "--out") {
			out.out = argv[++index]
			if (out.out === undefined) throw new Error("--out needs a value")
			continue
		}
		throw new Error(`unknown argument: ${arg}`)
	}
	return out
}
