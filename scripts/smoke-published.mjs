#!/usr/bin/env node
/**
 * External smoke test for the published SDK closure — the acceptance gate
 * before a release:
 *
 *   1. pack the 10 tarballs (`pnpm sdks:pack`),
 *   2. scaffold a plugin into a temp dir with the scaffolder
 *      (`create-hoardodile-plugin --tarballs`),
 *   3. in the standalone install: tsc --noEmit, build, vitest, one
 *      sandboxed `detect` through the CLI, and a short `dev` run (workbench
 *      served + detect on startup),
 *   4. report pass/fail and clean up.
 *
 * The scaffolded plugin installs ONLY from the tarballs — nothing from
 * the hoardodile workspace or the npm registry.
 *
 * The dev process tree is tracked via PID files in the OS temp dir (one
 * file per run); cleanup kills the recorded tree (`taskkill /T` on
 * Windows, the process group on POSIX) and stale PID files from crashed
 * runs are swept at startup. No process enumeration.
 *
 *   node scripts/smoke-published.mjs
 */
import { spawn } from "node:child_process"
import {
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { basename, join } from "node:path"

import { removeWithRetry } from "./lib/fs.mjs"
import { killTree, needsShell, run } from "./lib/process.mjs"
import { WORKSPACE_ROOT } from "./lib/workspace.mjs"

const SDKS_DIR = join(WORKSPACE_ROOT, "tmp", "sdks")
const CREATE_PLUGIN_BIN = join(
	WORKSPACE_ROOT,
	"plugins",
	"create-plugin",
	"dist",
	"index.js",
)
const PID_DIR = join(tmpdir(), "hoardodile-smoke-pids")

function sweepStalePids() {
	mkdirSync(PID_DIR, { recursive: true })
	for (const file of readdirSync(PID_DIR)) {
		const pid = Number.parseInt(readFileSync(join(PID_DIR, file), "utf8"), 10)
		if (Number.isInteger(pid) && pid > 1) killTree(pid)
		rmSync(join(PID_DIR, file), { force: true })
	}
}

async function waitForHttp(url, timeoutMs = 20_000) {
	const started = Date.now()
	while (Date.now() - started < timeoutMs) {
		try {
			const res = await fetch(url)
			if (res.ok) return true
		} catch {
			// not up yet
		}
		await new Promise((r) => setTimeout(r, 500))
	}
	return false
}

async function main() {
	sweepStalePids()
	const work = mkdtempSync(join(tmpdir(), "hoardodile-smoke-"))
	const pidFile = join(PID_DIR, `${basename(work)}.pid`)
	console.log(`[smoke] workspace: ${work}`)
	try {
		// 1. fresh tarballs
		console.log("\n[smoke] packing SDK tarballs...")
		run("pnpm", ["sdks:pack"], { cwd: WORKSPACE_ROOT })

		// 2. scaffold
		console.log("\n[smoke] scaffolding a plugin from the tarballs...")
		run("node", [CREATE_PLUGIN_BIN, "my-plugin", "--tarballs", SDKS_DIR], {
			cwd: work,
		})
		const pluginDir = join(work, "my-plugin")

		// 3. standalone verification (no workspace, no registry)
		console.log("\n[smoke] tsc --noEmit...")
		run("pnpm", ["exec", "tsc", "--noEmit"], { cwd: pluginDir })
		console.log("\n[smoke] pnpm build...")
		run("pnpm", ["build"], { cwd: pluginDir, timeout: 120_000 })
		console.log("\n[smoke] pnpm test...")
		run("pnpm", ["test"], { cwd: pluginDir })
		console.log("\n[smoke] hoardodile plugin run detect...")
		run(
			"pnpm",
			[
				"exec",
				"hoardodile",
				"plugin",
				"run",
				"detect",
				"testdata",
				"--plugin-dir",
				"dist",
			],
			{ cwd: pluginDir },
		)

		// 4. dev loop: watch-build + workbench + sandboxed detect
		console.log("\n[smoke] hoardodile plugin dev (workbench)...")
		const dev = spawn("pnpm", ["dev", "--port", "5199"], {
			cwd: pluginDir,
			shell: needsShell,
			stdio: "pipe",
			detached: !needsShell,
		})
		writeFileSync(pidFile, String(dev.pid))
		let devLog = ""
		dev.stdout?.on("data", (d) => (devLog += d))
		dev.stderr?.on("data", (d) => (devLog += d))
		let devExited = null
		dev.on("exit", (code) => {
			devExited = code
		})
		try {
			const up = await waitForHttp("http://127.0.0.1:5199/")
			if (!up) {
				throw new Error(
					`workbench did not come up on :5199${devExited !== null ? ` (dev exited ${devExited})` : ""}:\n${devLog.slice(-2000)}`,
				)
			}
			// The sandboxed capture is what makes the workbench faithful,
			// so assert both halves: the hook verdict in the log, and the
			// resource the page will actually open.
			if (!devLog.includes("detect ok")) {
				throw new Error(`dev detect did not pass:\n${devLog.slice(-2000)}`)
			}
			const listed = await fetch(
				"http://127.0.0.1:5199/api/workbench/resources",
			).then((res) => res.json())
			if (!Array.isArray(listed) || listed.length === 0) {
				throw new Error(
					`workbench served no resources: ${JSON.stringify(listed)}`,
				)
			}
			console.log("[smoke] workbench served + detect passed")
		} finally {
			// Kill the live tree FIRST — killing the cmd wrapper alone would
			// orphan the CLI and break taskkill's parent chain.
			killTree(dev.pid)
			dev.kill()
			rmSync(pidFile, { force: true })
			await new Promise((r) => setTimeout(r, 1500))
		}

		console.log("\n[smoke] ALL PASSED")
	} finally {
		removeWithRetry(work)
	}
}

main().catch((err) => {
	console.error(
		`\n[smoke] FAILED: ${err instanceof Error ? err.message : String(err)}`,
	)
	process.exit(1)
})
