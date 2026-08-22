#!/usr/bin/env node
/**
 * Standalone read-only check for leftovers of older storage layouts:
 * `source.hoard` archives (pre-bare-file layout) and root-level content
 * outside the `data/` content root (pre-`data/` layout). Run it on a
 * storage root before or after upgrading to confirm nothing old remains
 * — most importantly after restoring an old backup, where the new
 * server would otherwise silently show those resources as empty.
 *
 * Usage:
 *   node scripts/check-old-format.mjs <storageRoot> [--json]
 *
 * Exit 0 when no leftovers are found, 1 when they exist.
 */
import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"

const SOURCE_ARCHIVE_NAME = "source.hoard"
const CONTENT_DIR_NAME = "data"

function parseArgs(argv) {
	const root = argv[0]
	if (root === undefined) {
		console.error(
			"usage: node scripts/check-old-format.mjs <storageRoot> [--json]",
		)
		process.exit(2)
	}
	return { root, json: argv.includes("--json") }
}

async function leftoversOf(dir) {
	const out = []
	try {
		const info = await stat(join(dir, SOURCE_ARCHIVE_NAME))
		if (info.isFile()) out.push(join(dir, SOURCE_ARCHIVE_NAME))
	} catch {
		// no archive
	}
	const entries = await readdir(dir, { withFileTypes: true }).catch(() => [])
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue
		if (entry.isDirectory() && entry.name === CONTENT_DIR_NAME) continue
		out.push(join(dir, entry.name))
	}
	return out
}

async function collect(root) {
	const found = []
	const versionsDir = join(root, "versions")
	const versions = await readdir(versionsDir).catch(() => [])
	for (const version of versions) {
		const resourcesDir = join(versionsDir, version, "resources")
		const ids = await readdir(resourcesDir).catch(() => [])
		for (const id of ids) {
			found.push(...(await leftoversOf(join(resourcesDir, id))))
		}
	}
	const trashDir = join(root, "local", "trash")
	const trashItems = await readdir(trashDir).catch(() => [])
	for (const item of trashItems) {
		if (item.startsWith("resources-")) {
			found.push(...(await leftoversOf(join(trashDir, item))))
		}
	}
	return found.sort()
}

async function main() {
	const { root, json } = parseArgs(process.argv.slice(2))
	const rootInfo = await stat(root).catch(() => undefined)
	if (rootInfo === undefined || !rootInfo.isDirectory()) {
		console.error(`storage root not found: ${root}`)
		process.exit(2)
	}
	const found = await collect(root)
	if (found.length === 0) {
		if (json) {
			console.log(JSON.stringify({ found: [] }))
		} else {
			console.log(
				"no storage-layout leftovers — the library is on the data/ layout.",
			)
		}
		return
	}
	if (json) {
		console.log(JSON.stringify({ found }))
	} else {
		console.error(
			`found ${found.length} storage-layout leftover(s) — migrate them with:`,
		)
		console.error(
			"  node scripts/migrate-hoard-to-files.mjs <storageRoot> --dry-run",
		)
		for (const path of found) console.error(`  - ${path}`)
	}
	process.exitCode = 1
}

main().catch((err) => {
	console.error(err)
	process.exitCode = 1
})
