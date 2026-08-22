#!/usr/bin/env node
/**
 * Verifies the unified app version: the root package.json, every official
 * plugin manifest and every published SDK closure package must carry the
 * same version. Exits non-zero on mismatch. Wired into CI and the lefthook
 * pre-push hook.
 *
 *   node scripts/check-version-sync.mjs
 */

import { readFileSync } from "node:fs"
import {
	PLUGIN_MANIFESTS,
	PUBLISHED_PACKAGE_MANIFESTS,
} from "./lib/release-packages.mjs"

const files = [
	"package.json",
	...PLUGIN_MANIFESTS,
	...PUBLISHED_PACKAGE_MANIFESTS,
]

const versions = files.map((path) => ({
	path,
	version: JSON.parse(readFileSync(path, "utf8")).version,
}))

const expected = versions[0].version
const mismatched = versions.filter((entry) => entry.version !== expected)

if (mismatched.length > 0) {
	console.error(`Version mismatch (expected ${expected} from package.json):`)
	for (const entry of mismatched) {
		console.error(`  ${entry.path}: ${entry.version}`)
	}
	console.error(
		"Versions are bumped by `pnpm release`; fix the drift instead of editing by hand.",
	)
	process.exit(1)
}

console.log(`Version check passed (${expected}, ${files.length} files).`)
