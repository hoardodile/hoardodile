#!/usr/bin/env node
/**
 * Install git hooks via lefthook when this plugin is a git repository.
 *
 * Run from `postinstall` (see package.json). It is deliberately guarded:
 * inside the hoardodile monorepo `plugins/template` has no `.git` of its
 * own, and `create-hoardodile-plugin --tarballs` scaffolds into a temp
 * directory with no git repo at all — in both cases installing hooks would
 * either fail or write into the wrong repository, so we skip them.
 *
 * When a scaffolded/`cp`-ed plugin is in a real git repo, `lefthook install`
 * wires up the hooks declared in lefthook.yml. Re-run `lefthook install` if
 * you `git init` after dependency install.
 */

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"

if (!existsSync(".git")) {
	console.log("[plugin] no git repo found — skipping lefthook install")
	process.exit(0)
}

const result = spawnSync("lefthook", ["install"], {
	stdio: "inherit",
	shell: process.platform === "win32",
})
if (result.error) {
	console.error(`[plugin] lefthook install failed: ${result.error}`)
	process.exit(1)
}
process.exit(result.status ?? 1)
