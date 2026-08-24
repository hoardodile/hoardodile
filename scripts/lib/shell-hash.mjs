/**
 * Content hash over a directory tree: sorted relative paths + file bytes,
 * no mtime/uid — the SAME code yields the SAME hash on every build and on
 * the client. Must stay byte-identical with the client hasher
 * (apps/desktop/src/main/shell-hash.ts) — change both together.
 *
 * `excludePrefixes` (optional) skips entries whose relative path equals a
 * prefix or starts with `<prefix>/` — used by layer identities
 * (server-dist must not include server/node_modules).
 */

import { createHash } from "node:crypto"
import { existsSync, readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"

export async function contentHashTree(rootDir, options = {}) {
	const excludes = options.excludePrefixes ?? []
	const hash = createHash("sha256")

	function isExcluded(relPath) {
		for (const prefix of excludes) {
			if (relPath === prefix || relPath.startsWith(`${prefix}/`)) return true
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
