#!/usr/bin/env node
/**
 * Stage extra-resources/ for electron-builder: the sidecar's Node runtime
 * plus the shared server runtime tree (scripts/stage-runtime.mjs — server
 * dist + builtin file plugin + seed plugin dists, discovered, never a
 * hardcoded list) and the icons.
 *
 * The sidecar must run a real Node 24 runtime (ABI 137 for the packaged
 * natives): on Windows the Node running this script is reused (the
 * setup-node official binary); linux/macOS download a pinned, sha256-
 * verified nodejs.org dist (scripts/lib/node-dist.mjs).
 *
 * `--target`/`--arch` default to the host so `pnpm package:dir` works on
 * any OS; the release matrix passes them explicitly.
 *
 * Keep the whole staged tree under one extraResources entry
 * (electron-builder.config.mjs): electron-builder drops a `node_modules`
 * sitting at the ROOT of a single extraResources copy, but keeps nested
 * ones — `server/node_modules` must stay below the copy root. The post-pack
 * check is `scripts/verify-package.mjs`.
 */

import { spawnSync } from "node:child_process"
import {
	copyFileSync,
	existsSync,
	mkdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
	normalizeTarget,
	resolvePackTarget,
} from "../../../scripts/lib/resource-pack-targets.mjs"
import { stageRuntime } from "../../../scripts/stage-runtime.mjs"
import { installNodeDist } from "./lib/node-dist.mjs"

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(desktopRoot, "../..")
const destRoot = join(desktopRoot, "extra-resources")

const args = parseArgs(process.argv.slice(2))
const target = normalizeTarget(args.target ?? process.platform)
const resolved = resolvePackTarget(target, args.arch)
if (resolved === undefined) {
	throw new Error(`unsupported --target ${target} (win32 | linux | darwin)`)
}
const arch = resolved.arch
if (target === "win32" && process.platform !== "win32") {
	throw new Error(
		"Windows packaging must run on Windows (the sidecar runtime is process.execPath).",
	)
}
// The matrix lives in scripts/lib/resource-pack-targets.mjs (shared with
// build-resources-pack.mjs and verify-resources-pack.mjs).

rmSync(destRoot, { recursive: true, force: true })
mkdirSync(destRoot, { recursive: true })

const slugs = stageRuntime({ outDir: destRoot })

const nodeDestDir = join(destRoot, "node")
const nodePath =
	target === "win32"
		? copyRunningNode(nodeDestDir)
		: await installNodeDist({
				sourcePlatform: target,
				arch,
				cacheDir: join(workspaceRoot, "tmp", "node-dist"),
				destDir: nodeDestDir,
			})
console.log(`staged node runtime: ${nodePath}`)

copyFile(join(desktopRoot, "resources", "icon.png"), join(destRoot, "icon.png"))
copyFile(join(desktopRoot, "resources", "tray.png"), join(destRoot, "tray.png"))
writeResourcesMarker(destRoot, nodePath, { platform: target, arch })

console.log(
	`staged extra-resources at ${destRoot} (${slugs.length} seed plugins, target ${target}-${arch})`,
)

/**
 * The resources-version marker travels with both the installer and the
 * resource pack: the shell reads it at boot to reconcile
 * `desktop.json.resourceVersion` after a full install replaced the tree.
 * Keep the field names in sync with the client-side reader
 * (apps/desktop/src/main/resource-updater.ts).
 */
function writeResourcesMarker(destRoot, nodePath, info) {
	const rootPkg = JSON.parse(
		readFileSync(join(workspaceRoot, "package.json"), "utf8"),
	)
	const nodeVersion = spawnSync(nodePath, ["--version"], {
		encoding: "utf8",
	}).stdout.trim()
	const marker = {
		schema: 1,
		version: rootPkg.version,
		nodeVersion,
		platform: info.platform,
		arch: info.arch,
	}
	writeFileSync(
		join(destRoot, "resources-version.json"),
		`${JSON.stringify(marker, null, "\t")}\n`,
		"utf8",
	)
}

function copyRunningNode(destDir) {
	mkdirSync(destDir, { recursive: true })
	const destPath = join(destDir, "node.exe")
	copyFileSync(process.execPath, destPath)
	return destPath
}

function copyFile(src, dest) {
	if (!existsSync(src)) throw new Error(`missing ${src}`)
	copyFileSync(src, dest)
}

function parseArgs(argv) {
	const out = {}
	for (let index = 0; index < argv.length; index++) {
		const arg = argv[index]
		if (arg === "--target" || arg === "--arch") {
			const key = arg.slice(2)
			out[key] = argv[++index]
			if (out[key] === undefined) throw new Error(`${arg} needs a value`)
			continue
		}
		throw new Error(`unknown argument: ${arg}`)
	}
	return out
}
