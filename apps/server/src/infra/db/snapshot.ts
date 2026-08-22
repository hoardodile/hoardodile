import { copyFileSync, mkdirSync, rmSync } from "node:fs"
import { dirname } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import type { DbHandles } from "./connection.ts"

/**
 * SQLite snapshot mechanics shared by the version machinery and the
 * backup service: one "VACUUM INTO + verify" recipe and one
 * "copy + verify" recipe, instead of a copy per call site. The domain
 * error kinds stay at the callers — these helpers only report success.
 */

/**
 * Open the file read-only, run `PRAGMA integrity_check`, and close. A
 * dedicated handle is used (never the live `DbHandles`) so corruption
 * in a snapshot cannot contaminate the running process.
 */
export function verifySqliteIntegrity(path: string): boolean {
	let handle: InstanceType<typeof BetterSqlite3> | undefined
	try {
		handle = new BetterSqlite3(path, { readonly: true, fileMustExist: true })
		const rows = handle.pragma("integrity_check") as ReadonlyArray<{
			integrity_check: string
		}>
		return rows.length === 1 && rows[0]?.integrity_check === "ok"
	} catch {
		return false
	} finally {
		handle?.close()
	}
}

/**
 * Vacuum-snapshot the live DB into `dest`, then verify the snapshot.
 * Returns `false` (and removes the invalid file) when the snapshot
 * fails the integrity check; the caller decides the error to surface.
 */
export function vacuumSnapshotTo(db: DbHandles, dest: string): boolean {
	db.vacuumInto(dest)
	if (verifySqliteIntegrity(dest)) return true
	rmSync(dest, { force: true })
	return false
}

/**
 * Copy `src` to `dest` for read-only use, clearing any stale WAL/SHM
 * sidecars of a previous failed clone first. Cloning (rather than
 * opening the source directly) avoids any risk of corrupting the
 * immutable archive via SQLite WAL/SHM sidecars or stray writes.
 */
export function cloneSqliteFile(src: string, dest: string): void {
	mkdirSync(dirname(dest), { recursive: true })
	rmSync(dest, { force: true })
	rmSync(`${dest}-wal`, { force: true })
	rmSync(`${dest}-shm`, { force: true })
	copyFileSync(src, dest)
}
