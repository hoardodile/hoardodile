#!/usr/bin/env node
/**
 * One parameterized packaging chain replacing the per-platform pnpm
 * scripts (package / package:publish / package:linux / package:publish:linux
 * / package:mac / package:publish:mac / package:dir).
 *
 *   node scripts/package.mjs [--platform win|linux|mac] [--mode dir|install|publish]
 *
 *   --platform  target platform (default: host; win32/darwin aliases
 *               accepted, normalized by scripts/lib/resource-pack-targets.mjs)
 *   --mode      dir       -> unpacked app (electron-builder --dir), verify only
 *               install   -> installers for the platform, no upload
 *               publish   -> installers + resource pack + upload to the
 *                            release draft (PACK_UPLOAD gates the upload) +
 *                            update-feed verification
 *
 * The chain is the same order the old scripts ran: build → stage → package
 * → verify → pack/verify/upload/verify-feed (install/publish only).
 *
 * Requires the workspace install (pnpm) and, for publish, GH_TOKEN.
 */

import { execSync } from "node:child_process"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
	normalizeTarget,
	resolvePackTarget,
} from "../../../scripts/lib/resource-pack-targets.mjs"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const args = process.argv.slice(2)

function argValue(flag) {
	const index = args.indexOf(flag)
	return index >= 0 ? args[index + 1] : undefined
}

const target = normalizeTarget(argValue("--platform") ?? process.platform)
const mode = argValue("--mode") ?? "install"

if (resolvePackTarget(target) === undefined) {
	console.error(`unsupported --platform ${target} (win32 | linux | darwin)`)
	process.exit(1)
}
if (!["dir", "install", "publish"].includes(mode)) {
	console.error(`unsupported --mode ${mode} (dir | install | publish)`)
	process.exit(1)
}

/** slug used by the helper scripts (`--platform win|linux|mac`). */
const slug = { win32: "win", linux: "linux", darwin: "mac" }[target]

// The electron-builder target flags; the arch comes from the shared
// resource-pack table (must stay the same source as the pack artifacts).
const ELECTRON_TARGET_FLAGS = {
	win32: ["--win", "--x64"],
	linux: ["--linux", "--x64"],
	darwin: ["--mac", "--arm64"],
}

const STAGE_ARGS = {
	win32: [],
	linux: ["--target", "linux"],
	darwin: ["--target", "mac", "--arch", "arm64"],
}

function step(command, commandArgs) {
	const pretty = `${command} ${commandArgs
		.map((arg) => (/\s/.test(arg) ? `"${arg}"` : arg))
		.join(" ")}`
	console.log(`[package] $ ${pretty}`)
	execSync(pretty, { stdio: "inherit", cwd: ROOT, shell: true })
}

// 1. Build the workspace (the old scripts chained `pnpm build` first).
step("pnpm", ["build"])

// 2. Stage the server runtime + seed plugins into extra-resources.
step("node", ["scripts/stage-resources.mjs", ...STAGE_ARGS[target]])

// 3. Package: unpacked (`--dir`) or installers for the platform.
const publishFlag = mode === "publish" ? "always" : "never"
step("pnpm", [
	"exec",
	"electron-builder",
	"--config",
	"electron-builder.config.mjs",
	...(mode === "dir" ? ["--dir"] : ELECTRON_TARGET_FLAGS[target]),
	"--publish",
	publishFlag,
])

// 4. Verify the packaged app (natives + sandbox probe + asar guard).
step("node", ["scripts/verify-package.mjs", "--platform", slug])

if (mode === "dir") {
	console.log(`[package] done (${mode} ${target})`)
	process.exit(0)
}

// 5. Installer modes: resource pack + optional upload + feed verification.
step("node", ["scripts/build-resources-pack.mjs", "--platform", slug])
step("node", ["../../scripts/verify-resources-pack.mjs", "--platform", slug])
if (mode === "publish") {
	step("node", ["scripts/upload-resources-pack.mjs", "--platform", slug])
}
step("node", ["../../scripts/verify-feed.mjs", "--platform", slug])

console.log(`[package] done (${mode} ${target})`)
