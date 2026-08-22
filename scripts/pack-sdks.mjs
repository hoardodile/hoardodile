#!/usr/bin/env node
/**
 * Pack the plugin SDK packages into tarballs for out-of-tree plugin
 * repositories. `pnpm pack` rewrites the `workspace:*` and `catalog:` specs
 * in package manifests to concrete versions — plain `file:` directory
 * dependencies cannot resolve those specs outside this workspace, so
 * external plugins depend on the tarballs instead:
 *
 *   "@hoardodile/sdk-server": "file:<hoardodile>/tmp/sdks/hoardodile-sdk-server-0.0.0.tgz"
 *
 * Before packing, validates the publish closure: every tarball may only
 * depend on other release-set packages or third-party packages (no
 * `@hoardodile/schemas`/`@hoardodile/shared` — those stay internal to this
 * repo), and the official in-repo content plugins must only import
 * release-set or third-party packages.
 *
 *   node scripts/pack-sdks.mjs   # → tmp/sdks/*.tgz (gitignored)
 */

import { execSync } from "node:child_process"
import {
	existsSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	rmSync,
} from "node:fs"
import { join, resolve } from "node:path"

import { walkFiles } from "./lib/fs.mjs"
import {
	PACKAGE_DIRS,
	RELEASE_SET,
	SDK_CLOSURE,
	SDK_PACKAGE_DIRS,
	TERMINAL_PACKAGE_DIRS,
} from "./lib/sdk-closure.mjs"
import { tmpPath, WORKSPACE_ROOT } from "./lib/workspace.mjs"

const OUT_DIR = tmpPath("sdks")

// Every release-set package must be packed; drift would ship a closure
// that scaffolded plugins cannot resolve.
const ALL_PACKAGE_DIRS = [...SDK_PACKAGE_DIRS, ...TERMINAL_PACKAGE_DIRS]
const releaseDirs = [...RELEASE_SET].map((name) => PACKAGE_DIRS[name])
const drifted =
	ALL_PACKAGE_DIRS.length !== releaseDirs.length ||
	releaseDirs.some((dir) => !ALL_PACKAGE_DIRS.includes(dir))
if (drifted) {
	console.error(
		"[sdks:pack] packed dirs drifted from the release set — fix scripts/lib/sdk-closure.mjs.",
	)
	process.exit(1)
}

function readManifest(dir) {
	return JSON.parse(readFileSync(join(dir, "package.json"), "utf8"))
}

function validateClosure() {
	let failed = false
	for (const pkgDir of ALL_PACKAGE_DIRS) {
		const manifest = readManifest(resolve(WORKSPACE_ROOT, pkgDir))
		const allDeps = {
			...manifest.dependencies,
			...manifest.peerDependencies,
			...manifest.devDependencies,
		}
		for (const [name, spec] of Object.entries(allDeps)) {
			if (!name.startsWith("@hoardodile/")) continue
			if (!RELEASE_SET.has(name)) {
				console.error(
					`[sdks:pack] ${manifest.name} depends on ${name} (${spec}), which is not in the release set.`,
				)
				failed = true
			}
		}
	}

	// The SDK closure must be dependency-closed within itself: plugin code
	// only ever imports SDK packages, so no SDK package may depend on the
	// terminal runtime (host/host-web/workbench).
	for (const pkgDir of SDK_PACKAGE_DIRS) {
		const manifest = readManifest(resolve(WORKSPACE_ROOT, pkgDir))
		const allDeps = {
			...manifest.dependencies,
			...manifest.peerDependencies,
			...manifest.devDependencies,
		}
		for (const [name, spec] of Object.entries(allDeps)) {
			if (name.startsWith("@hoardodile/") && !SDK_CLOSURE.has(name)) {
				console.error(
					`[sdks:pack] ${manifest.name} depends on ${name} (${spec}), which is outside the SDK closure — terminal packages must be consumed by the app/dev tooling only, never by plugin code.`,
				)
				failed = true
			}
		}
	}
	return failed
}

function validateOfficialPluginImports() {
	const pluginDirs = ["gallery"]
	const importRe = /from\s+["'](@hoardodile\/[^"']+)["']/g
	let failed = false
	for (const pluginDir of pluginDirs) {
		const srcRoot = join(WORKSPACE_ROOT, "plugins", pluginDir, "src")
		if (!existsSync(srcRoot)) continue
		const files = walkFiles(srcRoot, [".ts", ".tsx"])
		for (const file of files) {
			const content = readFileSync(file, "utf8")
			for (const match of content.matchAll(importRe)) {
				const packageName = match[1].split("/").slice(0, 2).join("/")
				if (!RELEASE_SET.has(packageName)) {
					console.error(
						`[sdks:pack] ${pluginDir} imports ${match[1]} (${file}) — only release-set or third-party packages are allowed.`,
					)
					failed = true
				}
			}
		}
	}
	return failed
}

if (validateClosure() || validateOfficialPluginImports()) {
	console.error("[sdks:pack] publish closure validation failed.")
	process.exit(1)
}

rmSync(OUT_DIR, { recursive: true, force: true })
mkdirSync(OUT_DIR, { recursive: true })

for (const pkgDir of ALL_PACKAGE_DIRS) {
	console.log(`[sdks:pack] packing ${pkgDir}...`)
	execSync(`pnpm pack --pack-destination "${OUT_DIR}"`, {
		cwd: resolve(WORKSPACE_ROOT, pkgDir),
		stdio: "inherit",
		shell: true,
	})
}

console.log(`[sdks:pack] tarballs in ${OUT_DIR}:`)
for (const file of readdirSync(OUT_DIR)) {
	console.log(`  ${file}`)
}
