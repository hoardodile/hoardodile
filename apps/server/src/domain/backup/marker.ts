import { mkdirSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import { atomicWriteJsonSync, readJsonFile } from "src/infra/json-sidecar.ts"
import { assertInside, type StoragePaths } from "src/infra/storage/paths.ts"
import { z } from "zod"

/**
 * Persistent description of a restore the operator has asked for but that
 * has not yet been applied. The file sits under `{storage}/local/cache/tmp/`
 * (host-only) so it never leaks into the sync scope.
 *
 * The marker is written atomically via `rename` to guarantee that a reader
 * at boot time either sees nothing or sees a complete file.
 */
export const pendingRestoreMarker = z.object({
	pendingPath: z.string().min(1),
	dbFilePath: z.string().min(1),
	sourceName: z.string().min(1),
	requestedAt: z.number().int().nonnegative(),
})

export type PendingRestoreMarker = z.infer<typeof pendingRestoreMarker>

const MARKER_FILENAME = "restore.pending.json"

function markerPath(paths: StoragePaths): string {
	return paths.local.tmpFile(MARKER_FILENAME)
}

export type WritePendingRestoreInput = {
	readonly paths: StoragePaths
	readonly marker: PendingRestoreMarker
}

/**
 * Write (or replace) the pending-restore marker atomically.
 */
export function writePendingRestoreMarker(
	input: WritePendingRestoreInput,
): void {
	const { paths, marker } = input
	const target = markerPath(paths)
	const dir = dirname(target)
	mkdirSync(dir, { recursive: true })
	assertInside(paths.local.root, target)
	atomicWriteJsonSync(target, marker)
}

/**
 * Read the pending-restore marker if one exists. Returns `undefined` when
 * the file is missing or malformed; corrupt markers are silently ignored
 * rather than blocking startup.
 */
export function readPendingRestoreMarker(
	paths: StoragePaths,
): PendingRestoreMarker | undefined {
	const parsed = pendingRestoreMarker.safeParse(readJsonFile(markerPath(paths)))
	return parsed.success ? parsed.data : undefined
}

/** Remove the marker file if it exists. */
export function clearPendingRestoreMarker(paths: StoragePaths): void {
	rmSync(markerPath(paths), { force: true })
}

export const __testing__ = { MARKER_FILENAME }
