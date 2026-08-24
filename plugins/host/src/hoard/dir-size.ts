/**
 * Shared directory-size walk: the one implementation of "recursive byte
 * size of a directory tree" for host storage. Consumers opt into
 * different file policies via options:
 *
 * - vault totals skip dot-prefixed files (host temp staging), while
 *   storage totals count everything — see {@link vaultTotalSize} and
 *   `apps/server/src/domain/storage/service.ts`.
 *
 * Symbolic links are skipped so cycles cannot hang the walk and
 * linked-out files are not double counted; missing/transient entries
 * are ignored.
 */

import type { Dirent } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"

export type DirSizeOptions = {
	/** Skip file names starting with a dot (host temp staging). */
	readonly excludeDotPrefix?: boolean
}

export async function sumDirSizes(
	root: string,
	opts: DirSizeOptions = {},
): Promise<number> {
	let total = 0
	const stack = [root]
	while (stack.length > 0) {
		const dir = stack.pop()
		if (dir === undefined) continue
		let entries: Dirent[]
		try {
			entries = await readdir(dir, { withFileTypes: true })
		} catch {
			continue
		}
		for (const entry of entries) {
			if (entry.isSymbolicLink()) continue
			const full = join(dir, entry.name)
			if (entry.isDirectory()) {
				stack.push(full)
			} else if (entry.isFile()) {
				if (opts.excludeDotPrefix === true && entry.name.startsWith(".")) {
					continue
				}
				try {
					const info = await stat(full)
					total += info.size
				} catch {
					// File disappeared between readdir and stat.
				}
			}
		}
	}
	return total
}
