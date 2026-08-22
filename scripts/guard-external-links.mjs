#!/usr/bin/env node
/**
 * Static guard against links that can replace the SPA.
 *
 * Design invariant: the SPA never navigates outside itself with a bare
 * anchor or `window.open`. External links must go through
 * `apps/web/src/components/common/ExternalLink.tsx` (which routes desktop
 * clicks through the shell's `openExternal`, with the shell's navigation
 * policy as backstop), and links that intentionally open the app in a new
 * tab stay in `CharChip.tsx` (browser-only behavior; the desktop shell is
 * single-window). Everywhere else:
 *
 *   1. No `target=` attribute on anchors.
 *   2. No `href="http…"` / `href={`http…`` literal (production files only;
 *      tests exercise the real prop shapes).
 *   3. No `window.open(` — reserved for ExternalLink.tsx and CharChip.tsx.
 *
 * Usage:
 *   node scripts/guard-external-links.mjs            # full scan
 *   node scripts/guard-external-links.mjs --staged   # staged files only
 *   node scripts/guard-external-links.mjs <file>...  # explicit file list
 *
 * Violations must be fixed or the link moved through ExternalLink.
 */

import { execSync } from "node:child_process"
import { existsSync, globSync, readFileSync } from "node:fs"

const SCAN_PREFIX = "apps/web/src"

/** Files that may call window.open by design. */
const WINDOW_OPEN_ALLOWLIST = [
	"apps/web/src/components/common/ExternalLink.tsx",
	// Browser-only "open the character in a new tab" intent; the desktop
	// shell branch navigates the SPA in place instead.
	"apps/web/src/features/char/components/CharChip.tsx",
]

const TARGET_ATTR_RE = /\btarget\s*=\s*["'{]/g
const HTTP_HREF_RE = /href\s*=\s*["'{]https?:\/\//g
const WINDOW_OPEN_RE = /window\.open\s*\(/g

function normalizePath(file) {
	return file.replace(/\\/g, "/")
}

function isAllowedWindowOpen(file) {
	return WINDOW_OPEN_ALLOWLIST.includes(normalizePath(file))
}

function isTestFile(file) {
	return /\.test\.(ts|tsx)$/.test(normalizePath(file))
}

function isScannedSourceFile(file) {
	const normalized = normalizePath(file)
	return (
		normalized.startsWith(SCAN_PREFIX) &&
		/\.(ts|tsx)$/.test(normalized) &&
		existsSync(file)
	)
}

function getStagedFiles() {
	try {
		const output = execSync(
			"git diff --cached --name-only --diff-filter=ACMR",
			{ encoding: "utf8" },
		)
		return output.trim().split(/\r?\n/).filter(Boolean)
	} catch {
		return []
	}
}

function findViolations(file) {
	const raw = readFileSync(file, "utf8")
	const lines = raw.split(/\r?\n/)
	const violations = []

	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? ""
		const lineNumber = i + 1

		for (const match of line.matchAll(TARGET_ATTR_RE)) {
			violations.push({
				line: lineNumber,
				column: (match.index ?? 0) + 1,
				kind: "anchor target attribute (use ExternalLink)",
				snippet: line.trim(),
			})
		}

		if (!isTestFile(file)) {
			for (const match of line.matchAll(HTTP_HREF_RE)) {
				violations.push({
					line: lineNumber,
					column: (match.index ?? 0) + 1,
					kind: "literal external href (use ExternalLink)",
					snippet: line.trim(),
				})
			}
		}

		if (!isAllowedWindowOpen(file)) {
			for (const match of line.matchAll(WINDOW_OPEN_RE)) {
				violations.push({
					line: lineNumber,
					column: (match.index ?? 0) + 1,
					kind: "window.open (use ExternalLink)",
					snippet: line.trim(),
				})
			}
		}
	}

	return violations
}

function resolveTargetFiles() {
	const args = process.argv.slice(2)
	const useStaged = args.includes("--staged")
	const explicitFiles = args.filter((arg) => arg !== "--staged")

	if (useStaged) {
		return getStagedFiles().filter(isScannedSourceFile)
	}

	if (explicitFiles.length > 0) {
		return explicitFiles.filter(isScannedSourceFile)
	}

	return globSync(`${SCAN_PREFIX}/**/*.{ts,tsx}`)
}

function main() {
	const files = resolveTargetFiles()
	let totalViolations = 0

	for (const file of files) {
		const violations = findViolations(file)
		if (violations.length === 0) continue

		totalViolations += violations.length
		console.error(`\n${file}`)
		for (const v of violations) {
			console.error(`  ${v.kind} at ${v.line}:${v.column}\n    ${v.snippet}`)
		}
	}

	if (totalViolations > 0) {
		console.error(
			`\n${totalViolations} external-link guard violation(s) found.`,
		)
		console.error(
			"Links outside the SPA must go through ExternalLink (desktop opens them in the OS browser).",
		)
		process.exit(1)
	}

	console.log("External-link guard passed.")
}

main()
