#!/usr/bin/env node
/**
 * Guard against node types leaking into browser-facing package entries.
 * The published SDK surface must stay importable in a browser: a `node:`
 * reference in a d.ts means the entry pulls node types (or worse, node
 * modules) at compile time for consumers.
 *
 * Checks the dist d.ts files of the browser-facing root entries:
 *   - sdk-web       (all entries are browser)
 *   - sdk-react     (all entries are browser)
 *   - host-web      root entry only — `/node` backends are expected to
 *                   reference node and are excluded by their subpath
 *
 * Exit 1 on any violation. Wired into CI after the packages build.
 *
 *   node scripts/guard-node-pollution.mjs
 */

import { readFileSync, statSync } from "node:fs"
import { join, relative } from "node:path"

import { walkFiles } from "./lib/fs.mjs"
import { WORKSPACE_ROOT } from "./lib/workspace.mjs"

// package dir → subpaths of dist whose d.ts must be node-free
const CHECKED_ENTRIES = {
	"plugins/sdk-web": null, // whole dist
	"plugins/sdk-react": null, // whole dist
	"plugins/host-web": ["dist/index.d.ts"], // root entry only
}

const NODE_REF_RE =
	/node:[\w-]+|from\s+["']node:|\bBuffer\b|\bprocess\b|__dirname/

let failed = false

for (const [pkgDir, checked] of Object.entries(CHECKED_ENTRIES)) {
	const distDir = join(WORKSPACE_ROOT, pkgDir, "dist")
	if (!statSync(distDir, { throwIfNoEntry: false })?.isDirectory()) {
		console.warn(
			`[guard-node-pollution] ${pkgDir}/dist missing — build the packages first (or the package has no dist yet).`,
		)
		continue
	}
	const files =
		checked === null
			? walkFiles(distDir, [".d.ts"])
			: checked
					.map((p) => join(WORKSPACE_ROOT, pkgDir, p))
					.filter((p) => statSync(p, { throwIfNoEntry: false })?.isFile())
	for (const file of files) {
		const content = readFileSync(file, "utf8")
		if (NODE_REF_RE.test(content)) {
			console.error(
				`[guard-node-pollution] node reference found in ${relative(WORKSPACE_ROOT, file)}`,
			)
			failed = true
		}
	}
}

if (failed) {
	console.error(
		"[guard-node-pollution] browser-facing d.ts must not reference node. Split node-only code into a /node subpath.",
	)
	process.exit(1)
}
console.log("[guard-node-pollution] ok")
