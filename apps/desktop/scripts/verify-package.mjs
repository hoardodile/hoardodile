#!/usr/bin/env node
/**
 * Verify the packaged sidecar actually ships its native dependencies.
 *
 * electron-builder drops a `node_modules` that sits at the root of an
 * extraResources copy (see electron-builder.config.mjs), so the server that
 * lands in `resources/server/` must be re-checked after packaging: the
 * rollup bundle externalizes better-sqlite3 / sharp / @node-rs/argon2 and
 * the spawned media binaries, and the sidecar resolves them from
 * `resources/server/node_modules` at runtime (`createRequire` below mirrors
 * that path). A broken installer would otherwise only surface as a sidecar
 * that dies on launch.
 *
 * Add new externalized natives here when they are introduced.
 *
 * Usage:
 *   node scripts/verify-package.mjs            # after electron-builder ran
 */

import { existsSync } from "node:fs"
import { createRequire } from "node:module"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import { assertCopiedMediaBins } from "../../server/scripts/assert-media-bins.mjs"

const desktopRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const serverDir = resolve(
	desktopRoot,
	"release",
	"win-unpacked",
	"resources",
	"server",
)
const nativeRoot = join(serverDir, "node_modules")

const RESOLVABLE_NATIVES = [
	"better-sqlite3",
	"sharp",
	"@node-rs/argon2",
	"ffmpeg-static",
	"@derhuerst/ffprobe-static",
	"@hoardodile/7z-bin",
]

/** Files (relative to nativeRoot) the runtime needs in addition to resolution. */
const REQUIRED_FILES = [
	"better-sqlite3/prebuilds/win32-x64.node",
	"@img/sharp-win32-x64",
	"@node-rs/argon2-win32-x64-msvc",
	"ffmpeg-static/ffmpeg.exe",
	"@derhuerst/ffprobe-static/ffprobe.exe",
	"@hoardodile/7z-bin/bin/win32-x64/7z.exe",
]

function main() {
	if (!existsSync(nativeRoot)) {
		console.error(
			`sidecar native deps missing: ${nativeRoot}\n` +
				"electron-builder drops a node_modules at the root of an " +
				"extraResources copy; keep the staged server below the copy root " +
				"(see electron-builder.config.mjs).",
		)
		process.exit(1)
	}

	const missing = []
	const requireFromServer = createRequire(join(serverDir, "main.js"))
	for (const name of RESOLVABLE_NATIVES) {
		try {
			requireFromServer.resolve(name)
		} catch {
			missing.push(name)
		}
	}
	for (const relative of REQUIRED_FILES) {
		if (!existsSync(join(nativeRoot, relative))) {
			missing.push(relative)
		}
	}

	if (missing.length > 0) {
		console.error("packaged sidecar is missing native dependencies:")
		for (const entry of missing) {
			console.error(`  - ${entry}`)
		}
		process.exit(1)
	}

	assertCopiedMediaBins(nativeRoot)
	console.log(
		`verified sidecar natives in ${serverDir} (${RESOLVABLE_NATIVES.length} packages, media bins ok)`,
	)
}

main()
