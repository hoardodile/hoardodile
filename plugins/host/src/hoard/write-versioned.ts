import { conflict } from "../errors.ts"
import type { StoragePaths } from "./paths.ts"

/**
 * Command that performs a write under the **current** (latest, writable)
 * archive version. Receiving `paths.latest` instead of the whole
 * {@link StoragePaths} object makes it impossible for callers to accidentally
 * target `paths.active`, which may point at a frozen past version when the
 * server is in read-only viewing mode.
 */
export type VersionedWriteCommand<T> = (
	paths: StoragePaths["latest"],
) => T | Promise<T>

/**
 * Central gate for every file-system write that lands under `versions/<v>`.
 *
 * - Blocks the operation when `readOnly` is true, surfacing a domain conflict
 *   with code `server.read_only_archive`.
 * - Forces the command to operate on `paths.latest` (the latest archive
 *   version) so past frozen versions can never be mutated.
 *
 * Local-only writes (thumbs, caches, staging pool, trash) should NOT use this
 * helper; they live under `local/` and are governed by the route-level
 * write gate instead.
 */
export async function writeVersioned<T>(
	paths: StoragePaths,
	readOnly: boolean,
	cmd: VersionedWriteCommand<T>,
): Promise<T> {
	if (readOnly) {
		throw conflict(
			"server.read_only_archive",
			"server is viewing a read-only archive; versioned writes are blocked",
		)
	}
	return await cmd(paths.latest)
}
