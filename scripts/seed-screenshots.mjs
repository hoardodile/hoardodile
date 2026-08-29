#!/usr/bin/env node
/**
 * Seed the official demo library into an isolated storage root, boot
 * Fastify + Vite on ports that do not collide with `pnpm dev`, inject
 * desktop chrome via Playwright, and write screenshots under tmp/.
 *
 *   pnpm seed:screenshots
 *   pnpm seed:screenshots -- --reuse
 *   pnpm seed:screenshots -- --out ./somewhere
 *   pnpm seed:screenshots -- --skip-download
 *   pnpm seed:screenshots -- --lang en,zh
 *   pnpm seed:screenshots -- --lang zh --lang de
 */

import { spawn } from "node:child_process"
import { existsSync } from "node:fs"
import { join, resolve } from "node:path"

import { captureDemo, SUPPORTED_LANGUAGES } from "./lib/capture-demo.mjs"
import { removeWithRetry } from "./lib/fs.mjs"
import { killTree, needsShell, run } from "./lib/process.mjs"
import { tmpPath, WORKSPACE_ROOT } from "./lib/workspace.mjs"

const SERVER_PORT = "3010"
const VITE_PORT = "5174"
const VITE_HOST = "localhost"
const WAIT_HTTP_MS = 120_000

function parseLangList(value) {
	const codes = value
		.split(",")
		.map((item) => item.trim())
		.filter((item) => item.length > 0)
	if (codes.length === 0) {
		throw new Error("seed:screenshots: --lang requires a language code")
	}
	for (const code of codes) {
		if (!SUPPORTED_LANGUAGES.includes(code)) {
			throw new Error(
				`seed:screenshots: unsupported language ${JSON.stringify(code)} (supported: ${SUPPORTED_LANGUAGES.join(", ")})`,
			)
		}
	}
	return codes
}

function parseArgs(argv) {
	let reuse = false
	let skipDownload = false
	let outDir = tmpPath("demo-screenshots")
	const langs = []
	for (let i = 0; i < argv.length; i += 1) {
		const arg = argv[i]
		if (arg === undefined) continue
		if (arg === "--reuse") reuse = true
		else if (arg === "--skip-download") skipDownload = true
		else if (arg === "--lang") {
			const next = argv[i + 1]
			if (next === undefined || next.startsWith("--")) {
				throw new Error("seed:screenshots: --lang requires a language code")
			}
			langs.push(...parseLangList(next))
			i += 1
		} else if (arg.startsWith("--lang=")) {
			const value = arg.slice("--lang=".length)
			if (value.length === 0) {
				throw new Error("seed:screenshots: --lang requires a language code")
			}
			langs.push(...parseLangList(value))
		} else if (arg === "--out") {
			const next = argv[i + 1]
			if (next === undefined || next.startsWith("--")) {
				throw new Error("seed:screenshots: --out requires a directory path")
			}
			outDir = resolve(next)
			i += 1
		} else if (arg.startsWith("--out=")) {
			const value = arg.slice("--out=".length)
			if (value.length === 0) {
				throw new Error("seed:screenshots: --out requires a directory path")
			}
			outDir = resolve(value)
		} else if (arg === "--help" || arg === "-h") {
			process.stdout.write(
				[
					"Usage: pnpm seed:screenshots [-- --reuse] [-- --skip-download] [-- --out <dir>] [-- --lang <codes>]",
					"Wipe tmp/demo-storage, seed, capture desktop-styled screenshots to tmp/demo-screenshots/<lang>.",
					"--reuse keeps an already-seeded library (UI-only recapture).",
					"--lang <codes> captures one or more UI languages (comma-separated, repeatable; default: en).",
				].join("\n"),
			)
			process.stdout.write("\n")
			process.exit(0)
		} else {
			throw new Error(`seed:screenshots: unknown argument ${arg}`)
		}
	}
	const uniqueLangs = [...new Set(langs)]
	return {
		reuse,
		skipDownload,
		outDir,
		langs: uniqueLangs.length > 0 ? uniqueLangs : ["en"],
	}
}

function pluginDist(name) {
	return join(WORKSPACE_ROOT, "plugins", name, "dist")
}

function hasManifest(dir) {
	return existsSync(join(dir, "manifest.json"))
}

function ensurePluginBuild(filter, distDir) {
	if (hasManifest(distDir)) return
	console.log(`[seed:screenshots] building ${filter}...`)
	run("pnpm", ["exec", "turbo", "run", "build", `--filter=${filter}`], {
		cwd: WORKSPACE_ROOT,
	})
	if (!hasManifest(distDir)) {
		throw new Error(`seed:screenshots: ${distDir} is missing manifest.json`)
	}
}

async function waitForHttp(url, timeoutMs) {
	const started = Date.now()
	while (Date.now() - started < timeoutMs) {
		try {
			const res = await fetch(url)
			if (res.ok) return
		} catch {
			// not up yet
		}
		await new Promise((resolve) => setTimeout(resolve, 500))
	}
	throw new Error(`seed:screenshots: timed out waiting for ${url}`)
}

function spawnSvc(name, args, extraEnv) {
	console.log(`[seed:screenshots] starting ${name}...`)
	const child = spawn("pnpm", args, {
		cwd: WORKSPACE_ROOT,
		shell: needsShell,
		stdio: "inherit",
		detached: !needsShell,
		env: { ...process.env, ...extraEnv },
	})
	child.on("error", (err) => {
		console.error(`[seed:screenshots] ${name} failed to start:`, err)
	})
	return child
}

async function main() {
	const args = parseArgs(process.argv.slice(2))
	const storageRoot = tmpPath("demo-storage")
	const galleryDist = pluginDist("gallery")
	const fileDist = pluginDist("file")
	ensurePluginBuild("@hoardodile/plugin-file", fileDist)
	ensurePluginBuild("@hoardodile/plugin-gallery", galleryDist)

	if (!args.reuse) {
		console.log(`[seed:screenshots] wiping ${storageRoot}`)
		removeWithRetry(storageRoot)
	}

	const seedArgs = ["seed", "--", "--storage", storageRoot]
	if (args.skipDownload) seedArgs.push("--skip-download")
	run("pnpm", seedArgs, { cwd: WORKSPACE_ROOT })

	const previewEnv = {
		STORAGE_ROOT: storageRoot,
		PORT: SERVER_PORT,
		HOST: "127.0.0.1",
		SEED_PLUGIN_PATHS: galleryDist,
		DEV_PLUGIN_PATHS: galleryDist,
		BUILTIN_PATH: fileDist,
		VITE_SERVER_URL: `http://127.0.0.1:${SERVER_PORT}`,
	}
	const children = []
	function stopAll() {
		for (const child of children) {
			if (child.pid !== undefined) killTree(child.pid)
		}
		children.length = 0
	}
	process.on("SIGINT", () => {
		stopAll()
		process.exit(1)
	})
	process.on("SIGTERM", () => {
		stopAll()
		process.exit(1)
	})

	try {
		children.push(
			spawnSvc(
				"server",
				["-F", "@hoardodile/server", "exec", "vite-node", "src/main.ts"],
				previewEnv,
			),
		)
		// The web `dev` script runs these generators before Vite; invoke Vite
		// directly via `exec` with the options inline (no `--` separator). A
		// `pnpm run dev -- <args>` appends a stray `--` that Vite v8 treats as
		// the end of option parsing, so `--port` would be ignored and Vite
		// would bind its config default instead of VITE_PORT.
		run(
			"pnpm",
			[
				"-F",
				"@hoardodile/web",
				"exec",
				"node",
				"../../scripts/generate-licenses.mjs",
			],
			{ cwd: WORKSPACE_ROOT },
		)
		run(
			"pnpm",
			[
				"-F",
				"@hoardodile/web",
				"exec",
				"node",
				"../../scripts/generate-solar-lazy-index.mjs",
			],
			{ cwd: WORKSPACE_ROOT },
		)
		children.push(
			spawnSvc(
				"web",
				[
					"-F",
					"@hoardodile/web",
					"exec",
					"vite",
					"--host",
					VITE_HOST,
					"--port",
					VITE_PORT,
					"--strictPort",
				],
				previewEnv,
			),
		)
		await waitForHttp(`http://127.0.0.1:${SERVER_PORT}/health`, WAIT_HTTP_MS)
		await waitForHttp(`http://${VITE_HOST}:${VITE_PORT}/`, WAIT_HTTP_MS)
		for (const lang of args.langs) {
			await captureDemo({
				baseUrl: `http://${VITE_HOST}:${VITE_PORT}`,
				outDir: join(args.outDir, lang),
				storageRoot,
				lang,
			})
		}
		const langsLabel =
			args.langs.length === 1 ? args.langs[0] : args.langs.join(", ")
		console.log(`[seed:screenshots] done → ${args.outDir} (${langsLabel})`)
	} finally {
		stopAll()
	}
}

main().catch((err) => {
	const message = err instanceof Error ? err.message : String(err)
	console.error(`[seed:screenshots] ${message}`)
	process.exitCode = 1
})
