#!/usr/bin/env node
/**
 * Keep the embedded template (`src/template/`) in sync with the canonical
 * `plugins/template`. The scaffold copies `src/template`, so any drift
 * would ship to every new plugin.
 *
 *   node scripts/sync-template.mjs          # copy plugins/template → src/template
 *   node scripts/sync-template.mjs --check  # read-only drift check, exit 1 on drift (CI)
 *
 * dist/, node_modules/ and other build artifacts never enter the copy.
 */
import { createHash } from "node:crypto"
import { cpSync, readdirSync, readFileSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..")
const SRC_TEMPLATE = resolve(ROOT, "..", "template")
const EMBEDDED = resolve(ROOT, "src", "template")

const SKIP = new Set(["node_modules", "dist", ".turbo", ".playwright"])

function walk(dir) {
	const out = []
	for (const entry of readdirSync(dir, { withFileTypes: true })) {
		if (SKIP.has(entry.name)) continue
		const full = join(dir, entry.name)
		if (entry.isDirectory()) out.push(...walk(full))
		else out.push(full)
	}
	return out
}

/** Relative path → sha256, for every file below `dir` (artifacts skipped). */
function tree(dir) {
	const files = new Map()
	for (const file of walk(dir)) {
		const rel = file.slice(dir.length + 1).replaceAll("\\", "/")
		files.set(
			rel,
			createHash("sha256").update(readFileSync(file)).digest("hex"),
		)
	}
	return files
}

function sync() {
	rmSync(EMBEDDED, { recursive: true, force: true })
	cpSync(SRC_TEMPLATE, EMBEDDED, {
		recursive: true,
		filter: (src) => !SKIP.has(src.split(/[\\/]/).pop() ?? ""),
	})
}

const isCheck = process.argv.includes("--check")
if (isCheck) {
	// Read-only: compare the committed copy against the source without
	// touching it, so content drift fails CI instead of being silently
	// clobbered (the old check ran sync() first and compared file names).
	const source = tree(SRC_TEMPLATE)
	const embedded = tree(EMBEDDED)
	const drift = []
	for (const rel of [...source.keys()].sort()) {
		if (!embedded.has(rel)) drift.push(`missing: ${rel}`)
		else if (embedded.get(rel) !== source.get(rel))
			drift.push(`changed: ${rel}`)
	}
	for (const rel of [...embedded.keys()].sort()) {
		if (!source.has(rel)) drift.push(`extra: ${rel}`)
	}
	if (drift.length > 0) {
		console.error(
			`[create-plugin] template drift detected:\n  ${drift.join("\n  ")}\nRun \`node scripts/sync-template.mjs\` and commit the copy.`,
		)
		process.exit(1)
	}
	console.log("[create-plugin] embedded template in sync")
} else {
	sync()
	console.log("[create-plugin] template copied to src/template/")
}
