#!/usr/bin/env node
/**
 * Fail when a committed generated artifact no longer matches what the web
 * build would produce (see scripts/lib/generated-files.mjs). Run after
 * `pnpm build` in CI — the same guard in ci.yml and the release npm job.
 *
 *   node scripts/check-generated-files.mjs
 */

import { execFileSync } from "node:child_process"
import { GENERATED_FILES } from "./lib/generated-files.mjs"

const paths = GENERATED_FILES.map((file) => file.path)

// "XY <path>" per changed file (untracked files are not expected here — the
// artifacts are committed — so porcelain differences are exactly what drifts).
const status = execFileSync("git", ["status", "--porcelain", "--", ...paths], {
	encoding: "utf8",
})
const changed = new Set(
	status
		.split("\n")
		.filter((line) => line.length > 0)
		.map((line) => line.slice(3)),
)

if (changed.size > 0) {
	console.error(
		"Generated files are out of sync — the committed artifact was not regenerated with the current inputs:",
	)
	for (const { path, regenerate } of GENERATED_FILES) {
		if (changed.has(path)) {
			console.error(`  - ${path}\n    regenerate: ${regenerate}`)
		}
	}
	process.exit(1)
}

console.log("Committed generated artifacts in sync.")
