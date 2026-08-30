/**
 * Content hash over a directory tree: sorted relative paths + file bytes,
 * no mtime/uid — the SAME code yields the SAME hash on every build and on
 * the client. Must stay byte-identical with the client hasher
 * (apps/desktop/src/main/shell-hash.ts) — change both together.
 *
 * `excludePrefixes` (optional) skips entries whose relative path equals a
 * prefix or starts with `<prefix>/` — used by layer identities
 * (server-dist must not include server/node_modules). `excludeExtensions`
 * skips files whose relative path ends with one of the given extensions
 * (used to keep sourcemaps out of the shell hash).
 */

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

/**
 * The shell-runtime boundary the resource channel's `shellHash` counts.
 * `wizard` (a content page, not the shell) and `*.map` (never affect
 * runtime) are excluded on every side — the pack builder, the verify gate,
 * the e2e fixture and the client (apps/desktop/src/main/shell-hash.ts).
 * One export so a release cannot ship with those consumers disagreeing (a
 * drift misroutes a content release to the full updater).
 */
export const SHELL_HASH_BOUNDARY = Object.freeze({
	excludePrefixes: ["wizard"],
	excludeExtensions: [".map"],
})

export async function contentHashTree(rootDir, options = {}) {
	const excludes = options.excludePrefixes ?? []
	const excludedExtensions = options.excludeExtensions ?? []
	const hash = createHash("sha256")

	function isExcluded(relPath) {
		for (const prefix of excludes) {
			if (relPath === prefix || relPath.startsWith(`${prefix}/`)) return true
		}
		return false
	}

	function isExcludedFile(relPath) {
		for (const ext of excludedExtensions) {
			if (relPath.endsWith(ext)) return true
		}
		return false
	}

	async function walk(dir, rel) {
		const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
			a.name < b.name ? -1 : a.name > b.name ? 1 : 0,
		)
		for (const entry of entries) {
			const relPath = rel === "" ? entry.name : `${rel}/${entry.name}`
			if (isExcluded(relPath)) continue
			const full = join(dir, entry.name)
			if (entry.isDirectory()) {
				hash.update(`${relPath}/\0`)
				await walk(full, relPath)
			} else if (entry.isFile()) {
				if (isExcludedFile(relPath)) continue
				hash.update(`${relPath}\0`)
				hash.update(readFileSync(full))
			} else {
				throw new Error(
					`unsupported entry type in shell tree (symlink?): ${full}`,
				)
			}
		}
	}

	if (!existsSync(rootDir)) {
		throw new Error(`missing shell tree root: ${rootDir}`)
	}
	await walk(rootDir, "")
	return `sha256:${hash.digest("hex")}`
}
