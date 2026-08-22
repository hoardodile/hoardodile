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

const changed = []
for (const path of files) {
	const manifest = JSON.parse(readFileSync(path, "utf8"))
	if (manifest.version === version) {
		console.log(`unchanged ${path} (${version})`)
		continue
	}
	manifest.version = version
	writeFileSync(path, `${JSON.stringify(manifest, null, "\t")}\n`)
	changed.push(path)
	console.log(`synced ${path} -> ${version}`)
}

// JSON.stringify output is not biome-canonical (arrays stay expanded);
// reformat the touched files so the release commit still passes lint.
if (changed.length > 0) {
	try {
		execFileSync("pnpm", ["exec", "biome", "check", "--write", ...changed], {
			stdio: "inherit",
		})
	} catch {
		console.warn("warning: biome formatting of synced files failed")
	}
}

try {
	execFileSync("git", ["add", ...files], { stdio: "inherit" })
} catch {
	console.warn("warning: could not stage manifests with git")
}
