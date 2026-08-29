#!/usr/bin/env node
/**
 * Sync the plugin version from `package.json` into `manifest.json`. Invoked by
 * release-it's after:bump hook (the version was just bumped in package.json),
 * so the tag `v<version>` and the packaged zip name match the manifest the
 * marketplace reads. Idempotent; also safe to run standalone.
 *
 * `manifest.json` is biome-canonical, so patch only the version value —
 * JSON.parse + JSON.stringify would reflow arrays and need a post-format pass.
 *
 *   node scripts/sync-version.mjs
 */

import { readFileSync, writeFileSync } from "node:fs"

const { version } = JSON.parse(readFileSync("package.json", "utf8"))
const path = "manifest.json"

let source
try {
	source = readFileSync(path, "utf8")
} catch {
	throw new Error(`could not read ${path} — is this the plugin root?`)
}

const next = source.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`)
if (next === source) {
	console.log(`unchanged ${path} (${version})`)
	process.exit(0)
}

// Guard: the patch must stay valid JSON carrying the requested version.
const patched = JSON.parse(next)
if (patched.version !== version) {
	throw new Error(`version field mismatch after syncing ${path}`)
}
writeFileSync(path, next)
console.log(`synced ${path} -> ${version}`)
