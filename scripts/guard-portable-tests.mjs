#!/usr/bin/env node
/**
 * Static guard against Windows-path literals in tests.
 *
 * Root issue: a test that hardcodes a drive-letter path (`C:\...`, a
 * `String.raw` backslash path, or a literal `\` separator in an expected
 * path) only reflects the author's machine — the ubuntu/macos runners
 * join with `/`, so the expectation mismatches the implementation and the
 * matrix turns red. The failure arrives late (a whole test run) instead
 * of at commit time, and it used to be hidden by a matrix that canceled
 * the other legs.
 *
 * Rule: expected filesystem paths in tests must be built from
 * `join()`/`resolve()`/`sep` (the implementation's own primitives), never
 * from a drive-letter/backslash literal. Windows-behavior cases (e.g.
 * asserting win32 cache bases, rejecting Windows-style destinations) are
 * legitimate — mark such a line with `// path-guard-exempt` (same pattern
 * as `// write-guard-exempt`).
 *
 * Usage:
 *   node scripts/guard-portable-tests.mjs            # full scan
 *   node scripts/guard-portable-tests.mjs --staged   # staged files only
 *   node scripts/guard-portable-tests.mjs <file>...  # explicit file list
 *
 * Violations must be fixed or the line annotated.
 */

import { execSync } from "node:child_process"
import { globSync, readFileSync } from "node:fs"

/** Drive-letter paths inside any string/template literal. */
const DRIVE_PATH_RE = /["'`][A-Za-z]:\\/g
/** `String.raw` templates containing at least one backslash. */
const RAW_BACKSLASH_RE = /String\.raw\s*["'`][^"'`]*\\/g

/** Per-line escape hatch, mirroring the `// write-guard-exempt` pattern. */
const EXEMPT_MARKER = "// path-guard-exempt"

function normalizePath(file) {
	return file.replace(/\\/g, "/")
}

function isTestFile(file) {
	return /\.test\.(ts|tsx)$/.test(normalizePath(file))
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
	const lines = readFileSync(file, "utf8").split(/\r?\n/)
	const violations = []
	for (let i = 0; i < lines.length; i++) {
		const line = lines[i] ?? ""
		// The marker may sit on the offending line or on the comment line
		// directly above it.
		if (
			line.includes(EXEMPT_MARKER) ||
			(lines[i - 1] ?? "").includes(EXEMPT_MARKER)
		) {
			continue
		}
		let kind
		if (DRIVE_PATH_RE.test(line)) {
			kind = "drive-letter path literal (build it with join()/resolve()/sep)"
		} else if (RAW_BACKSLASH_RE.test(line)) {
			kind =
				"String.raw backslash path literal (build it with join()/resolve()/sep)"
		}
		if (kind !== undefined) {
			violations.push({
				line: i + 1,
				column: line.search(/["'`]/) + 1,
				kind,
				snippet: line.trim(),
			})
		}
	}
	return violations
}

function resolveTargetFiles() {
	const args = process.argv.slice(2)
	const useStaged = args.includes("--staged")
	const explicitFiles = args.filter((arg) => arg !== "--staged")

	if (useStaged) {
		return getStagedFiles().filter(isTestFile)
	}
	if (explicitFiles.length > 0) {
		return explicitFiles.filter(isTestFile)
	}
	return globSync("**/*.test.{ts,tsx}", { ignore: ["node_modules/**"] })
}

const files = resolveTargetFiles()
let total = 0
for (const file of files) {
	const violations = findViolations(file)
	for (const violation of violations) {
		total += 1
		console.error(
			`${normalizePath(file)}:${violation.line}:${violation.column} ${violation.kind}\n    ${violation.snippet}`,
		)
	}
}

if (total > 0) {
	console.error(
		`\n${total} portability violation(s) in test paths — use join()/resolve()/sep in expectations, or mark the line with "${EXEMPT_MARKER}" when a Windows literal is the behavior under test.`,
	)
	process.exit(1)
}
console.log(`portable-tests guard passed (${files.length} test files checked).`)
