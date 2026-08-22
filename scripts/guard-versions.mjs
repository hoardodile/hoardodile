#!/usr/bin/env node
/**
 * Static guard that prevents accidental writes to frozen archive versions.
 *
 * Design invariant: in `apps/server/src` and `plugins/host/src`, any path
 * under `versions/<v>` that is written to must come from `writeVersioned`'s
 * `latest` argument. Reads of historical data may use
 * `paths.atVersion(v)`, but only read-only fs calls.
 *
 * This script enforces two rules:
 *   1. No `paths.active.<method>()` in production code. `paths.active`
 *      resolves to the active (viewing) version, which may be a read-only
 *      past archive. Use `paths.latest` for latest-version work or
 *      `paths.atVersion(v)` for explicit cross-version reads.
 *   2. No fs write call (`mkdir`, `writeFile`, `rm`, `rename`, `copyFile`,
 *      `unlink`, `createWriteStream`, etc.) that passes `paths.atVersion(...)`
 *      as a direct argument. Such writes would mutate a frozen archive.
 *
 * The storage primitives themselves (`plugins/host/src/hoard/`) define the
 * abstraction and are exempt; everything else must go through the gate.
 *
 * Usage:
 *   node scripts/guard-versions.mjs            # full scan
 *   node scripts/guard-versions.mjs --staged   # staged files only
 *   node scripts/guard-versions.mjs <file>...  # explicit file list
 *
 * Violations must be fixed or explicitly exempted with a comment that
 * contains `// write-guard-exempt` on the offending line.
 */

import { execSync } from "node:child_process"
import { existsSync, globSync, readFileSync } from "node:fs"

const SCAN_PREFIXES = ["apps/server/src", "plugins/host/src"]

/** Definition site for the path abstraction and the versioned-write gate. */
const EXCLUDED_PREFIXES = ["plugins/host/src/hoard"]

const EXCLUDED_PATTERNS = [
	// Allow `paths.active` in test files and in the paths definition tests.
	/\btest\.ts$/,
]

const WRITE_FUNCTION_NAMES = [
	"mkdir",
	"mkdirSync",
	"writeFile",
	"writeFileSync",
	"rm",
	"rmSync",
	"rename",
	"renameSync",
	"copyFile",
	"copyFileSync",
	"unlink",
	"unlinkSync",
	"appendFile",
	"appendFileSync",
	"truncate",
	"truncateSync",
	"symlink",
	"symlinkSync",
	"link",
	"linkSync",
	"createWriteStream",
]

const ACTIVE_PATH_RE = /\bpaths\.active\.\w+\s*\(/g
const AT_VERSION_WRITE_RE = new RegExp(
	`\\b(${WRITE_FUNCTION_NAMES.join("|")})\\s*\\(\\s*paths\\.atVersion\\s*\\(`,
	"g",
)
const EXEMPT_RE = /\/\/\s*write-guard-exempt/

function normalizePath(file) {
	return file.replace(/\\/g, "/")
}

function isExcluded(file) {
	const normalized = normalizePath(file)
	for (const prefix of EXCLUDED_PREFIXES) {
		if (normalized.startsWith(prefix)) return true
	}
	for (const pattern of EXCLUDED_PATTERNS) {
		if (pattern.test(normalized)) return true
	}
	return false
}

function isScannedSourceFile(file) {
	const normalized = normalizePath(file)
	return (
		SCAN_PREFIXES.some((prefix) => normalized.startsWith(prefix)) &&
		normalized.endsWith(".ts") &&
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
		if (EXEMPT_RE.test(line)) continue

		for (const match of line.matchAll(ACTIVE_PATH_RE)) {
			violations.push({
				line: i + 1,
				column: (match.index ?? 0) + 1,
				kind: "paths.active usage",
				snippet: line.trim(),
			})
		}

		for (const match of line.matchAll(AT_VERSION_WRITE_RE)) {
			violations.push({
				line: i + 1,
				column: (match.index ?? 0) + 1,
				kind: "fs write on paths.atVersion(...)",
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
		return getStagedFiles().filter(isScannedSourceFile)
	}

	if (explicitFiles.length > 0) {
		return explicitFiles.filter(isScannedSourceFile)
	}

	return SCAN_PREFIXES.flatMap((prefix) => globSync(`${prefix}/**/*.ts`))
}

function main() {
	const files = resolveTargetFiles()
	let totalViolations = 0

	for (const file of files) {
		if (isExcluded(file)) continue
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
			`\n${totalViolations} versioned-write guard violation(s) found.`,
		)
		console.error(
			"All writes under versions/<v> must go through writeVersioned and target paths.latest.",
		)
		process.exit(1)
	}

	console.log("Versioned-write guard passed.")
}

main()
