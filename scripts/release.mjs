#!/usr/bin/env node
/**
 * `pnpm release <version>` — release-it with a GitHub token.
 *
 * release-it can only create the GitHub Release draft with a GITHUB_TOKEN;
 * without one it falls back to web mode and the draft is later auto-created
 * empty by electron-builder in CI (name = version, no changelog). Provision
 * the token from `gh auth token` (scopes: repo) when the env var is unset.
 *
 * The release-it binary is run directly with process.execPath — on Windows
 * the `pnpm`/`.cmd` shims are not launchable via execFileSync, and spawn
 * semantics differ across shells; invoking the JS entry is uniform.
 *
 *   node scripts/release.mjs [release-it args...]
 */

import { execFileSync, spawnSync } from "node:child_process"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")

if (!process.env.GITHUB_TOKEN) {
	try {
		process.env.GITHUB_TOKEN = execFileSync("gh", ["auth", "token"], {
			encoding: "utf8",
		}).trim()
		console.log("GITHUB_TOKEN provisioned from `gh auth token`.")
	} catch {
		console.warn(
			"GITHUB_TOKEN is unset and `gh auth token` failed — release-it will fall back to a web-based GitHub Release (the draft is then created by CI without changelog notes).",
		)
	}
}

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
