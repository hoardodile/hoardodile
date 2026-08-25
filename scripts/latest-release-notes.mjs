#!/usr/bin/env node
/**
 * Print the newest `## <version>` section of CHANGELOG.md to stdout — the
 * body for the GitHub Release draft. A release whose notes were generated
 * by a web-fallback release-it never got one, so the pipeline fills the
 * draft from this (and future releases stay bounded: only the latest
 * section, not the cumulative file).
 *
 *   node scripts/latest-release-notes.mjs
 */

import { readFileSync } from "node:fs"

const content = readFileSync("CHANGELOG.md", "utf8")
const lines = content.split(/\r?\n/)

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

if (start < 0) {
	console.log(content.trim())
	process.exit(0)
}

console.log(lines.slice(start, end).join("\n").trim())
