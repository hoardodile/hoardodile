/**
 * Changelog helpers shared by the release-draft machinery.
 */

import { readFileSync } from "node:fs"

/**
 * The newest `## <version>` section of a conventional-changelog file, or
 * the whole (trimmed) content when no section header exists. The GitHub
 * release body is the section only — bounded, never the cumulative file.
 */
export function latestReleaseNotes(content) {
	const text = content ?? readFileSync("CHANGELOG.md", "utf8")
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

	if (start < 0) return text.trim()
	return lines.slice(start, end).join("\n").trim()
}
