#!/usr/bin/env node
/**
 * `pnpm release <version>` — one-click release for this plugin.
 *
 * Runs release-it, which bumps `package.json`, syncs the new version into
 * `manifest.json` (after:bump → scripts/sync-version.mjs), writes a
 * Conventional-Commits `CHANGELOG.md`, commits `chore(release): v<version>`,
 * tags `v<version>` and pushes. Publishing the GitHub release itself is CI's
 * job: the pushed tag triggers `.github/workflows/release.yml`, which builds,
 * packages (`release/<id>-<version>.zip` + `.sha256`) and creates the
 * published release the marketplace picks up — so no local GITHUB_TOKEN or
 * `gh` CLI is needed. Manual `git tag v<version> && git push origin v<version>`
 * still works as a fallback.
 *
 * release-it is launched with process.execPath — on Windows the `pnpm`/`.cmd`
 * shims are not reliably launchable, so invoking the JS entry is uniform.
 *
 *   node scripts/release.mjs [release-it args...]
 */

import { spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { dirname, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

const releaseItBin = resolve(
	ROOT,
	"node_modules",
	"release-it",
	"bin",
	"release-it.js",
)
if (!existsSync(releaseItBin)) {
	console.error(
		`release-it not found at ${releaseItBin} — run pnpm install first.`,
	)
	process.exit(1)
}

const result = spawnSync(
	process.execPath,
	[releaseItBin, ...process.argv.slice(2)],
	{
		stdio: "inherit",
		env: process.env,
	},
)
if (result.error) {
	console.error(`failed to launch release-it: ${result.error}`)
	process.exit(1)
}
process.exit(result.status ?? 1)
