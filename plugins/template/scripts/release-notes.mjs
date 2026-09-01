#!/usr/bin/env node
/**
 * Print the newest `## <version>` section of CHANGELOG.md (the release notes)
 * so the tag-triggered release workflow can set it as the GitHub release body.
 * Mirrors hoardodile's scripts/lib/changelog.mjs latestReleaseNotes().
 *
 *   node scripts/release-notes.mjs
 */

import { readFileSync } from "node:fs"

const text = readFileSync("CHANGELOG.md", "utf8")
const lines = text.split(/\r?\n/)

let start = -1
let end = lines.length
for (let i = 0; i < lines.length; i++) {
	if (/^##\s+/.test(lines[i])) {
		if (start < 0) start = i
		else {
			end = i
			break
		}
	}
}

process.stdout.write(
	start < 0 ? text.trim() : lines.slice(start, end).join("\n").trim(),
)
