#!/usr/bin/env node
/**
 * Syncs the unified app version from the root package.json into every
 * plugin manifest and every published SDK package manifest, then stages
 * them so the release commit includes them. Invoked by release-it's
 * after:bump hook; also safe to run standalone (idempotent).
 *
 *   node scripts/sync-version.mjs
 */

import { execFileSync } from "node:child_process"
import { readFileSync, writeFileSync } from "node:fs"
import {
	PLUGIN_MANIFESTS,
	PUBLISHED_PACKAGE_MANIFESTS,
} from "./lib/release-packages.mjs"

const { version } = JSON.parse(readFileSync("package.json", "utf8"))
const files = [...PLUGIN_MANIFESTS, ...PUBLISHED_PACKAGE_MANIFESTS]

for (const path of files) {
	const source = readFileSync(path, "utf8")
	// These manifests are biome-canonical in the repo, so patch only the
	// version value: JSON.parse + JSON.stringify would reflow arrays and
	// need a post-format pass (which also failed silently on Windows,
	// where `pnpm` is a .cmd shim execFileSync cannot launch).
	const next = source.replace(/("version"\s*:\s*)"[^"]*"/, `$1"${version}"`)
	if (next === source) {
		console.log(`unchanged ${path} (${version})`)
		continue
	}
	// Guard: the patch must stay valid JSON carrying the requested version.
	const patched = JSON.parse(next)
	if (patched.version !== version) {
		throw new Error(`version field mismatch after syncing ${path}`)
	}
	writeFileSync(path, next)
	console.log(`synced ${path} -> ${version}`)
}

try {
	execFileSync("git", ["add", ...files], { stdio: "inherit" })
} catch {
	console.warn("warning: could not stage manifests with git")
}
