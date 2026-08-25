#!/usr/bin/env node
/**
 * Fail unless the checked-out tag carries the unified root version.
 *
 * The release workflow runs on `push: tags: v*`; a tag that does not match
 * `package.json` must never publish — release-it creates `v${version}`, so
 * any drift here means a manual tag or a forgotten bump. (Manual
 * `workflow_dispatch` runs validate the version and the tag inside
 * `scripts/ensure-release-draft.mjs` instead, since a branch checkout has no
 * local tag to check.)
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const version = JSON.parse(readFileSync("package.json", "utf8")).version
const expected = `v${version}`

const tags = execFileSync("git", ["tag", "--points-at", "HEAD"], {
	encoding: "utf8",
})
	.split("\n")
	.map((line) => line.trim())
	.filter((line) => line.length > 0)

if (!tags.includes(expected)) {
	console.error(
		`tag check failed: expected ${expected} at HEAD, found: ${
			tags.join(", ") || "(no tags)"
		}`,
	)
	process.exit(1)
}

console.log(`tag check passed: HEAD is ${expected}`)
