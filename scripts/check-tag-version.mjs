#!/usr/bin/env node
/**
 * Fail unless the checked-out tag carries the unified root version.
 *
 * The release workflow runs on `push: tags: v*`; a tag that does not match
 * `package.json` must never publish — release-it creates `v${version}`, so
 * any drift here means a manual tag or a forgotten bump.
 *
 * `--tag <name>` (workflow_dispatch re-runs): the checkout is the branch,
 * not a tag, so instead assert that the given tag name matches the root
 * version and exists in the repository.
 */

import { execFileSync } from "node:child_process"
import { readFileSync } from "node:fs"

const version = JSON.parse(readFileSync("package.json", "utf8")).version
const expected = `v${version}`

const tagArgIndex = process.argv.indexOf("--tag")
const expectedTag = tagArgIndex >= 0 ? process.argv[tagArgIndex + 1] : undefined

if (expectedTag !== undefined) {
	if (expectedTag !== expected) {
		console.error(
			`tag check failed: --tag ${expectedTag} does not match the root version ${expected}`,
		)
		process.exit(1)
	}
	// The dispatch checkout is a shallow branch clone (fetch-depth: 1) that
	// does not fetch tags — query the remote instead of the local refs.
	try {
		const remoteTags = execFileSync(
			"git",
			["ls-remote", "--tags", "origin", `refs/tags/${expectedTag}`],
			{ encoding: "utf8" },
		)
		if (remoteTags.trim().length === 0) {
			console.error(`tag check failed: ${expectedTag} is not a tag on origin`)
			process.exit(1)
		}
	} catch {
		console.error(`tag check failed: could not query origin for ${expectedTag}`)
		process.exit(1)
	}
	console.log(`tag check passed (dispatch): ${expectedTag}`)
	process.exit(0)
}

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
