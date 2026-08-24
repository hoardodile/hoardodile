#!/usr/bin/env node
/**
 * Copy the sidecar tree into extra-resources/ for electron-builder:
 * node.exe, apps/server/dist, seed plugin dists (every plugin dir under
 * `plugins/<slug>/dist` with a manifest, see
 * lib/plugin-channels.mjs — nothing here names a plugin).
 *
 * Keep the whole staged tree under one extraResources entry
 * (electron-builder.config.mjs): electron-builder drops a `node_modules`
 * sitting at the ROOT of a single extraResources copy, but keeps nested
 * ones — `server/node_modules` must stay below the copy root. The post-pack
 * check is `scripts/verify-package.mjs`.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { findSeedPluginDists } from "../../../scripts/lib/plugin-channels.mjs"
import { assertCopiedMediaBins } from "../../server/scripts/assert-media-bins.mjs"

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const workspaceRoot = resolve(desktopRoot, "../..")
const destRoot = join(desktopRoot, "extra-resources")

if (process.platform !== "win32") {
	throw new Error("desktop packaging is Windows x64 only")
}

rmSync(destRoot, { recursive: true, force: true })
mkdirSync(destRoot, { recursive: true })

function copyDir(src, dest) {
	if (!existsSync(src)) {
		throw new Error(`missing ${src}`)
	}
	mkdirSync(dirname(dest), { recursive: true })
	cpSync(src, dest, { recursive: true, dereference: true })
}

function copyFile(src, dest) {
	if (!existsSync(src)) {
		throw new Error(`missing ${src}`)
	}
	mkdirSync(dirname(dest), { recursive: true })
	copyFileSync(src, dest)
}

const serverDist = join(workspaceRoot, "apps", "server", "dist")
const serverDest = join(destRoot, "server")
copyDir(serverDist, serverDest)
assertCopiedMediaBins(join(serverDest, "node_modules"))

// The builtin fallback (file) is staged separately — it is the one plugin
// that is never a seed, served through BUILTIN_PATH instead.
copyDir(
	join(workspaceRoot, "plugins", "file", "dist"),
	join(destRoot, "plugins", "file"),
)

const seedDists = findSeedPluginDists(workspaceRoot)
if (seedDists.length === 0) {
	throw new Error("no seed plugin dists found under plugins/*/dist")
}
for (const dist of seedDists) {
	const slug = dist.split(/[/\\]/).at(-2) ?? "plugin"
	copyDir(dist, join(destRoot, "plugins", slug))
}

const nodeDestDir = join(destRoot, "node")
mkdirSync(nodeDestDir, { recursive: true })
copyFile(process.execPath, join(nodeDestDir, "node.exe"))

copyFile(join(desktopRoot, "resources", "icon.png"), join(destRoot, "icon.png"))
copyFile(join(desktopRoot, "resources", "tray.png"), join(destRoot, "tray.png"))

console.log(
	`staged extra-resources at ${destRoot} (${String(seedDists.length)} seed plugins)`,
)
