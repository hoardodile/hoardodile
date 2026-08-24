#!/usr/bin/env node
/**
 * Static guard against "i18n wrapper" components.
 *
 * Design invariant: `@hoardodile/ui` components own their chrome copy
 * (they read `useTranslation("ui")`), so consumers never re-wrap them to
 * feed translated strings — a wrapper that imports a ui component under a
 * renamed alias (`import { X as YShell } from "@hoardodile/ui/components/…"`
 * pattern) exists only to inject copy and is a smell. Every such wrapper
 * was deleted in the i18n migration; this guard keeps them from coming
 * back. Icon renames (`Route as RouteIcon` style) are not component
 * wrapping and stay exempt; the deliberate domain wrappers that remain in
 * apps/web are allowlisted below.
 *
 * Usage:
 *   node scripts/guard-i18n-wrappers.mjs            # full scan
 *   node scripts/guard-i18n-wrappers.mjs --staged   # staged files only
 *   node scripts/guard-i18n-wrappers.mjs <file>...  # explicit file list
 */

import { execSync } from "node:child_process"
import { existsSync, globSync, readFileSync } from "node:fs"

const SCAN_PREFIXES = ["apps/web/src", "plugins/workbench/src"]

/**
 * Files that legitimately rename-alias a ui component import. Each entry
 * needs a reason: these three are domain wrappers (component chrome is
 * already consumed inside the shared ui package), NOT i18n wrappers.
 */
const ALIAS_ALLOWLIST = new Set([
	// Persists user presets (prefSync) and renders tag-chip special styles.
	"apps/web/src/components/common/ColorPicker.tsx",
	// Owns the font registry (presets, CSS loading) and preset display names.
	"apps/web/src/components/common/FontPicker.tsx",
	// Supplies the schemas-derived search-query length cap.
	"apps/web/src/components/common/SearchField.tsx",
])

/**
 * `import { … } from "@hoardodile/ui/components/…"` (braces may span
 * lines). Icon renames (`Route as RouteIcon`) target `…/icons/*` and are
 * not component wrapping — only `components/` imports are scanned.
 */
const UI_IMPORT_RE =
	/import\s*\{[^}]*\}\s*from\s*["']@hoardodile\/ui\/components\//gs
/** Any rename alias inside the import braces (`X as Y`). */
const ALIAS_RE = /\bas\s+[A-Za-z0-9_$]+\b/

function normalizePath(file) {
	return file.replace(/\\/g, "/")
}

function isTestFile(file) {
	return /\.test\.(ts|tsx)$/.test(normalizePath(file))
}

function isScannedSourceFile(file) {
	const normalized = normalizePath(file)
	return (
		SCAN_PREFIXES.some((prefix) => normalized.startsWith(prefix)) &&
		/\.(ts|tsx)$/.test(normalized) &&
		existsSync(file) &&
		!isTestFile(file)
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
	const violations = []
	for (const match of raw.matchAll(UI_IMPORT_RE)) {
		if (!ALIAS_RE.test(match[0])) continue
		const lineNumber = raw.slice(0, match.index ?? 0).split(/\r?\n/).length
		violations.push({
			line: lineNumber,
			column: (match.index ?? 0) + 1,
			kind: "renamed alias import of a @hoardodile/ui component (i18n wrapper)",
			snippet: match[0].replace(/\s+/g, " ").trim(),
		})
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

	return SCAN_PREFIXES.flatMap((prefix) => globSync(`${prefix}/**/*.{ts,tsx}`))
}

function main() {
	const files = resolveTargetFiles()
	let totalViolations = 0

	for (const file of files) {
		const normalized = normalizePath(file)
		if (ALIAS_ALLOWLIST.has(normalized)) continue
		const violations = findViolations(file)
		if (violations.length === 0) continue

		totalViolations += violations.length
		console.error(`\n${file}`)
		for (const v of violations) {
			console.error(`  ${v.kind} at ${v.line}:${v.column}\n    ${v.snippet}`)
		}
	}

	if (totalViolations > 0) {
		console.error(`\n${totalViolations} i18n-wrapper guard violation(s) found.`)
		console.error(
			"ui components own their chrome copy — delete the wrapper or add the file to the allowlist with a reason.",
		)
		process.exit(1)
	}

	console.log("i18n-wrapper guard passed.")
}

main()
