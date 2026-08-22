#!/usr/bin/env node
/**
 * Copy the sidecar tree into extra-resources/ for electron-builder:
 * node.exe, apps/server/dist, official plugin dists.
 */
import { copyFileSync, cpSync, existsSync, mkdirSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
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

const plugins = [
	["file", join(workspaceRoot, "plugins", "file", "dist")],
	["gallery", join(workspaceRoot, "plugins", "gallery", "dist")],
]
for (const [id, src] of plugins) {
	copyDir(src, join(destRoot, "plugins", id))
}

const nodeDestDir = join(destRoot, "node")
mkdirSync(nodeDestDir, { recursive: true })
copyFile(process.execPath, join(nodeDestDir, "node.exe"))

copyFile(join(desktopRoot, "resources", "icon.png"), join(destRoot, "icon.png"))
copyFile(join(desktopRoot, "resources", "tray.png"), join(destRoot, "tray.png"))

console.log(`staged extra-resources at ${destRoot}`)
