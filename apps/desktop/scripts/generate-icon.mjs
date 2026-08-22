#!/usr/bin/env node
/**
 * Copies the web app logo (`apps/web/public/logo.png`) into
 * `apps/desktop/resources/icon.png` for the tray, window, and installer.
 */
import { copyFileSync, existsSync, mkdirSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const src = resolve(desktopRoot, "../../apps/web/public/logo.png")
if (!existsSync(src)) {
	throw new Error(`web logo not found at ${src}`)
}

const outDir = resolve(desktopRoot, "resources")
mkdirSync(outDir, { recursive: true })
const outFile = resolve(outDir, "icon.png")
copyFileSync(src, outFile)
console.log(`copied ${src} -> ${outFile}`)
