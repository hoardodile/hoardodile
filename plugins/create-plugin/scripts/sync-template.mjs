#!/usr/bin/env node
/**
 * Keep the embedded template (`src/template/`) in sync with the canonical
 * `plugins/template`. The scaffold copies `src/template`, so any drift
 * would ship to every new plugin.
 *
 *   node scripts/sync-template.mjs          # copy plugins/template → src/template
 *   node scripts/sync-template.mjs --check  # exit 1 on drift (CI)
 *
 * dist/, node_modules/ and other build artifacts never enter the copy.
 */
import { cpSync, readdirSync, rmSync } from "node:fs"
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

function sync() {
	rmSync(EMBEDDED, { recursive: true, force: true })
	cpSync(SRC_TEMPLATE, EMBEDDED, {
		recursive: true,
		filter: (src) => !SKIP.has(src.split(/[\\/]/).pop() ?? ""),
	})
}

const isCheck = process.argv.includes("--check")
if (isCheck) {
	sync()
	const embeddedFiles = walk(EMBEDDED).map((f) =>
		f.slice(EMBEDDED.length + 1).replaceAll("\\", "/"),
	)
	const sourceFiles = walk(SRC_TEMPLATE)
		.map((f) => f.slice(SRC_TEMPLATE.length + 1).replaceAll("\\", "/"))
		.filter((f) => !SKIP.has(f.split("/")[0] ?? ""))
	const drift = [
		...embeddedFiles.filter((f) => !sourceFiles.includes(f)),
		...sourceFiles.filter((f) => !embeddedFiles.includes(f)),
	]
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
