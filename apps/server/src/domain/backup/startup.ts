import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import { resolveClock } from "src/infra/service.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"
import {
	clearPendingRestoreMarker,
	readPendingRestoreMarker,
} from "./marker.ts"

export type ApplyPendingRestoreDeps = {
	readonly paths: StoragePaths
	readonly now?: () => number
	/**
	 * Logger callback; the server passes a pino child. Kept narrow so the
	 * module stays loggable without importing fastify/pino types.
	 */
	readonly log?: (
		event: string,
		fields: Readonly<Record<string, unknown>>,
	) => void
}

export type ApplyPendingRestoreResult =
	| { readonly applied: false; readonly reason?: string }
	| {
			readonly applied: true
			readonly sourceName: string
			readonly previousPath: string
			readonly dbFilePath: string
	  }

/**
 * Apply a pending restore if one is recorded. Must run before any DB
 * connection is opened -- the swap is a file-level operation.
 *
 * Algorithm:
 * 1. Read the marker under `{storage}/local/cache/tmp/`. Missing -> no-op.
 * 2. Validate the staged snapshot exists and is non-empty.
 * 3. Move the live DB (plus any `-wal` / `-shm` sidecars) into a
 *    timestamped folder under `{storage}/local/trash/`.
 * 4. Move the staged snapshot into place at the live DB path.
 * 5. Clear the marker.
 *
 * Any failure mid-way leaves the marker in place so the next boot retries.
 */
export function applyPendingRestore(
	deps: ApplyPendingRestoreDeps,
): ApplyPendingRestoreResult {
	const { paths } = deps
	const { now } = resolveClock(deps)
	const log = deps.log ?? (() => {})

	const marker = readPendingRestoreMarker(paths)
	if (marker === undefined) return { applied: false }

	if (!existsSync(marker.pendingPath)) {
		clearPendingRestoreMarker(paths)
		log("backup.restore.missing_source", { sourceName: marker.sourceName })
		return { applied: false, reason: "pending source missing" }
	}
	const stat = statSync(marker.pendingPath)
	if (!stat.isFile() || stat.size === 0) {
		clearPendingRestoreMarker(paths)
		rmSync(marker.pendingPath, { force: true })
		log("backup.restore.invalid_source", { sourceName: marker.sourceName })
		return { applied: false, reason: "pending source invalid" }
	}

	const trashDir = join(paths.local.trash(), `db-${now()}`)
	mkdirSync(trashDir, { recursive: true })
	mkdirSync(dirname(marker.dbFilePath), { recursive: true })

	const previousDbInTrash = join(trashDir, basename(marker.dbFilePath))
	for (const suffix of ["", "-wal", "-shm"] as const) {
		const live = `${marker.dbFilePath}${suffix}`
		if (!existsSync(live)) continue
		renameSync(live, `${previousDbInTrash}${suffix}`)
	}

	renameSync(marker.pendingPath, marker.dbFilePath)
	clearPendingRestoreMarker(paths)

	log("backup.restore.applied", {
		sourceName: marker.sourceName,
		previousPath: previousDbInTrash,
		dbFilePath: marker.dbFilePath,
	})

	return {
		applied: true,
		sourceName: marker.sourceName,
		previousPath: previousDbInTrash,
		dbFilePath: marker.dbFilePath,
	}
}
