import { copyFileSync, mkdirSync, readdirSync, rmSync, statSync } from "node:fs"
import { basename, dirname, join } from "node:path"
import type { AutoSnapshotStatus, BackupSummary } from "@hoardodile/schemas"
import { conflict, invalid, notFound } from "@hoardodile/shared"
import { count, isNull } from "drizzle-orm"
import type { SQLiteColumn, SQLiteTable } from "drizzle-orm/sqlite-core"
import { orderBy } from "es-toolkit"
import { deleteAuthRow } from "src/domain/auth/repo.ts"
import { characters } from "src/domain/char/schema.ts"
import { documents } from "src/domain/doc/schema.ts"
import { resources } from "src/domain/res/schema.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import {
	vacuumSnapshotTo,
	verifySqliteIntegrity,
} from "src/infra/db/snapshot.ts"
import {
	createSidecar,
	sidecarNumber,
	sidecarString,
} from "src/infra/json-sidecar.ts"
import { type ClockDeps, resolveClock } from "src/infra/service.ts"
import {
	assertInside,
	assertSafeSegment,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import { writePendingRestoreMarker } from "./marker.ts"

/**
 * Prefix embedded in every generated manual snapshot filename so non-generated
 * or user-dropped files in `versions/db-backups/` are ignored when listing.
 */
const BACKUP_FILE_PREFIX = "app-"
/**
 * Prefix embedded in every automatic daily snapshot filename so the manual
 * and automatic sets never collide, and files dropped into `snapshots/`
 * are ignored when listing.
 */
const AUTO_BACKUP_FILE_PREFIX = "auto-"
/** Suffix for generated snapshots; matches the live DB file extension. */
const BACKUP_FILE_SUFFIX = ".sqlite"

export type BackupServiceDeps = ClockDeps & {
	readonly db: DbHandles
	readonly paths: StoragePaths
	/**
	 * Absolute path to the live DB file. Restores swap this file by moving
	 * the pending snapshot into place and the previous file into trash.
	 * Must not be `:memory:`; restore on an in-memory DB is unsupported.
	 */
	readonly dbFilePath: string
	/**
	 * Returns the version number that is currently active at backup time.
	 * Stored alongside the snapshot so the UI can relate backups to the
	 * archive version they belong to. Defaults to 0 for callers that do
	 * not need version tracking (e.g. restore-only utilities).
	 */
	readonly getActiveVersion?: () => number
	/**
	 * Scheduler configuration surfaced by {@link BackupService.getAutoStatus}.
	 * Optional — absent in restore-only utilities, where the status simply
	 * reports the feature as disabled.
	 */
	readonly autoSnapshot?: { readonly enabled: boolean; readonly keep: number }
}

export type BackupCreateInput = {
	readonly name?: string
	readonly note?: string
}

export type BackupUpdateMetaInput = {
	readonly name?: string
	readonly note?: string
}

export type BackupService = {
	/**
	 * Produce a consistent single-file snapshot of the live DB under
	 * `{storage}/versions/<v>/db-backups/`. Safe to call while writes are in
	 * flight; SQLite serialises `VACUUM INTO` against the WAL.
	 *
	 * @throws {DomainError} `backup.integrity_failed` when the freshly
	 *   written snapshot does not pass `PRAGMA integrity_check`.
	 */
	create(input?: BackupCreateInput): Promise<BackupSummary>
	/**
	 * Produce an automatic daily snapshot of the live DB under
	 * `{storage}/versions/<v>/snapshots/` (a sibling of the manual
	 * `db-backups/` folder). Shares the {@link create} pipeline
	 * (VACUUM INTO + integrity check + auth-stripping) but skips the
	 * user-facing name/note metadata. Files are named `auto-*.sqlite` so
	 * they never mix with manual backups.
	 *
	 * @throws {DomainError} `backup.integrity_failed` when the freshly
	 *   written snapshot does not pass `PRAGMA integrity_check`.
	 */
	createAuto(): Promise<BackupSummary>
	/**
	 * Roll the automatic snapshot window: keep only the `keep` newest
	 * *days* of `auto-*.sqlite` files in the current (writable) version's
	 * `snapshots/` folder — one file per day, for `keep` distinct dates —
	 * deleting the rest together with their sidecars. Archived versions are
	 * never touched — their snapshots are frozen.
	 */
	pruneAuto(keep: number): Promise<void>
	/**
	 * Report the automatic snapshot scheduler's runtime state: whether it
	 * is enabled, its retention window in days, and the creation time of
	 * the newest automatic snapshot across all versions (null when none
	 * exist). Lightweight — scans snapshot folders only.
	 */
	getAutoStatus(): Promise<AutoSnapshotStatus>
	/**
	 * List every snapshot currently on disk, newest first. Files that do
	 * not match the `app-*.sqlite` / `auto-*.sqlite` naming are skipped so
	 * users can drop other files into the folders without polluting the list.
	 */
	list(): Promise<readonly BackupSummary[]>
	/**
	 * Permanently remove a snapshot and its sidecar metadata. The file is
	 * unlinked (not moved to trash) because backups are already themselves
	 * the trash.
	 *
	 * @throws {DomainError} `backup.not_found` when `fileName` does not exist.
	 */
	delete(fileName: string): Promise<void>
	/**
	 * Validate and stage a restore from `fileName`: copies the snapshot into
	 * `local/cache/tmp/` and writes a crash-safe marker. The caller (tRPC router)
	 * is responsible for scheduling the in-process restart after the HTTP
	 * response has been flushed.
	 *
	 * @throws {DomainError} `backup.not_found` / `backup.integrity_failed`
	 *   when the source cannot be used. `backup.memory_db_not_restorable`
	 *   when the live DB is `:memory:`.
	 */
	prepareRestore(fileName: string): Promise<void>
	/**
	 * Update user-visible metadata (`name` and/or `note`) attached to a backup.
	 * Both fields are persisted in the sidecar `.meta.json` file so they travel
	 * with the snapshot when the `versions/` folder is copied elsewhere.
	 *
	 * @throws {DomainError} `backup.not_found` when `fileName` does not exist.
	 */
	updateMeta(fileName: string, input: BackupUpdateMetaInput): Promise<void>
	/**
	 * Resolve the on-disk path of a snapshot for read-only streaming
	 * (download). Like restore, snapshots left behind in archived versions
	 * are located too, but never mutated.
	 *
	 * @throws {DomainError} `backup.not_found` when `fileName` does not exist.
	 */
	resolveFilePath(fileName: string): Promise<string>
	/**
	 * Snapshot the live runtime DB to an arbitrary `destination` path
	 * (`VACUUM INTO` + integrity check), e.g. a temp file for download.
	 *
	 * @throws {DomainError} `backup.integrity_failed` when the freshly
	 *   written snapshot does not pass `PRAGMA integrity_check`.
	 */
	snapshotRuntimeDb(destination: string): Promise<void>
}

/**
 * Build a {@link BackupService}. Pure closure; no hidden singletons.
 */
export function createBackupService(deps: BackupServiceDeps): BackupService {
	const { db, paths, dbFilePath, getActiveVersion, autoSnapshot } = deps
	const { now } = resolveClock(deps)

	function create(input?: BackupCreateInput): BackupSummary {
		// Backups are mutable working copies and belong to the current
		// (latest, writable) version only. Never write into `paths.active`,
		// which may point at a read-only past version when the user is
		// viewing an archive.
		const backupsDir = paths.latest.dbBackups()
		mkdirSync(backupsDir, { recursive: true })
		const fileName = buildBackupName(now())
		const destination = paths.latest.dbBackup(fileName)
		// `assertInside` gives a belt-and-braces check against symlinked or
		// otherwise drifting versions roots.
		assertInside(backupsDir, destination)
		if (!vacuumSnapshotTo(db, destination)) {
			throw invalid(
				"backup.integrity_failed",
				"snapshot failed integrity check",
				{ fileName },
			)
		}
		stripAuthFromSnapshot(destination)
		const trimmedName = input?.name?.trim()
		const trimmedNote = input?.note?.trim()
		writeBackupMeta(destination, {
			name: trimmedName && trimmedName.length > 0 ? trimmedName : undefined,
			note: trimmedNote && trimmedNote.length > 0 ? trimmedNote : undefined,
			activeVersion: (getActiveVersion ?? (() => 0))(),
			...liveEntityCounts(),
		})
		return summarise(destination)
	}

	function createAuto(): BackupSummary {
		const snapshotsDir = paths.latest.snapshots()
		mkdirSync(snapshotsDir, { recursive: true })
		const fileName = buildAutoBackupName(now())
		const destination = paths.latest.snapshot(fileName)
		// `assertInside` gives a belt-and-braces check against symlinked or
		// otherwise drifting versions roots.
		assertInside(snapshotsDir, destination)
		if (!vacuumSnapshotTo(db, destination)) {
			throw invalid(
				"backup.integrity_failed",
				"snapshot failed integrity check",
				{ fileName },
			)
		}
		stripAuthFromSnapshot(destination)
		writeBackupMeta(destination, {
			activeVersion: (getActiveVersion ?? (() => 0))(),
			...liveEntityCounts(),
		})
		return summarise(destination)
	}

	/**
	 * Live (non-trashed) entity counts of the runtime DB, recorded with
	 * every snapshot so the restore UI can show what a backup contains.
	 * Three cheap COUNT queries against indexed `deleted_at` columns.
	 */
	function liveEntityCounts(): {
		readonly countResources: number
		readonly countCharacters: number
		readonly countDocuments: number
	} {
		const countLive = <
			T extends SQLiteTable & { readonly deletedAt: SQLiteColumn },
		>(
			table: T,
		) =>
			db.db
				.select({ count: count() })
				.from(table)
				.where(isNull(table.deletedAt))
				.get()?.count ?? 0
		return {
			countResources: countLive(resources),
			countCharacters: countLive(characters),
			countDocuments: countLive(documents),
		}
	}

	function pruneAuto(keep: number): void {
		if (keep < 1) return
		const dir = paths.latest.snapshots()
		if (!pathExists(dir)) return
		const files = readdirSync(dir).filter(isAutoBackupFilename)
		// Keep one file per date, for the `keep` newest dates. Same-day
		// restart churn must not eat the retention window.
		const newestPerDate = new Map<string, string>()
		for (const name of files.sort()) {
			const date = dateKeyOfAutoName(name)
			if (date !== undefined) newestPerDate.set(date, name)
		}
		const keptNames = new Set(
			[...newestPerDate.entries()]
				.sort((a, b) => (a[0] < b[0] ? 1 : -1))
				.slice(0, keep)
				.map(([, name]) => name),
		)
		for (const name of files) {
			if (keptNames.has(name)) continue
			const path = join(dir, name)
			rmSync(path, { force: true })
			rmSync(backupMetaPath(path), { force: true })
		}
	}

	function getAutoStatus(): AutoSnapshotStatus {
		return {
			enabled: autoSnapshot?.enabled ?? false,
			keep: autoSnapshot?.keep ?? 3,
			lastAt: latestAutoCreatedAt(),
		}
	}

	/**
	 * Creation time of the newest automatic snapshot across every version.
	 * Filenames embed ascending timestamps, so the newest-named file per
	 * folder is the newest snapshot in it — no per-file parse needed.
	 */
	function latestAutoCreatedAt(): number | null {
		let newest: number | null = null
		for (let v = 1; v <= paths.latestVersion; v++) {
			const dir = paths.atVersion(v).snapshots()
			if (!pathExists(dir)) continue
			const newestName = readdirSync(dir)
				.filter(isAutoBackupFilename)
				.sort()
				.at(-1)
			if (newestName === undefined) continue
			try {
				const ts = statSync(join(dir, newestName)).mtimeMs
				if (newest === null || ts > newest) newest = ts
			} catch {
				// Entry disappeared between readdir and stat.
			}
		}
		return newest
	}

	function list(): readonly BackupSummary[] {
		const summaries: BackupSummary[] = []
		for (let v = 1; v <= paths.latestVersion; v++) {
			const version = paths.atVersion(v)
			const dirs = [version.dbBackups(), version.snapshots()]
			for (const dir of dirs) {
				if (!pathExists(dir)) continue
				for (const entry of readdirSync(dir)) {
					if (!isGeneratedBackupFilename(entry)) continue
					try {
						summaries.push(summarise(join(dir, entry)))
					} catch {
						// Skip entries that disappeared between readdir and stat.
					}
				}
			}
		}
		return orderBy(summaries, [(s) => s.createdAt], ["desc"])
	}

	function deleteBackup(fileName: string): void {
		const path = resolveBackupPath(fileName, { writable: true })
		if (!pathExists(path)) {
			throw notFound("backup.not_found", `backup ${fileName} does not exist`, {
				fileName,
			})
		}
		rmSync(path, { force: true })
		rmSync(backupMetaPath(path), { force: true })
	}

	function updateMeta(fileName: string, input: BackupUpdateMetaInput): void {
		if (isAutoBackupFilename(fileName)) {
			throw conflict(
				"backup.auto_readonly",
				`auto snapshot ${fileName} is transient and cannot be renamed or annotated`,
				{ fileName },
			)
		}
		const path = resolveBackupPath(fileName, { writable: true })
		if (!pathExists(path)) {
			throw notFound("backup.not_found", `backup ${fileName} does not exist`, {
				fileName,
			})
		}
		const existing = readBackupMeta(path)
		const trimmedName = input.name?.trim()
		const trimmedNote = input.note?.trim()

		const nextName =
			input.name === undefined
				? existing?.name
				: trimmedName && trimmedName.length > 0
					? trimmedName
					: undefined
		const nextNote =
			input.note === undefined
				? existing?.note
				: trimmedNote && trimmedNote.length > 0
					? trimmedNote
					: undefined

		writeBackupMeta(path, {
			name: nextName,
			note: nextNote,
			activeVersion: existing?.activeVersion,
		})
	}

	function prepareRestore(fileName: string): void {
		if (dbFilePath === ":memory:") {
			throw conflict(
				"backup.memory_db_not_restorable",
				"cannot restore into an in-memory database",
			)
		}
		// Restore resolves in writable mode on purpose: backups frozen in an
		// archived version must never roll the live DB back across version
		// boundaries — they throw `backup.archived_readonly`. Downloads
		// (`resolveFilePath`) still resolve archived files read-only.
		const source = resolveBackupPath(fileName, { writable: true })
		if (!pathExists(source)) {
			throw notFound("backup.not_found", `backup ${fileName} does not exist`, {
				fileName,
			})
		}
		if (!verifySqliteIntegrity(source)) {
			throw invalid(
				"backup.integrity_failed",
				"backup failed integrity check",
				{ fileName },
			)
		}
		stageRestore({ paths, source, dbFilePath, fileName, ts: now() })
	}

	return {
		create: async (input) => create(input),
		createAuto: async () => createAuto(),
		pruneAuto: async (keep) => pruneAuto(keep),
		getAutoStatus: async () => getAutoStatus(),
		list: async () => list(),
		delete: async (fileName) => deleteBackup(fileName),
		prepareRestore: async (fileName) => prepareRestore(fileName),
		updateMeta: async (fileName, input) => updateMeta(fileName, input),
		resolveFilePath: async (fileName) => resolveFilePath(fileName),
		snapshotRuntimeDb: async (destination) => snapshotRuntimeDb(destination),
	}

	function resolveFilePath(fileName: string): string {
		const path = resolveBackupPath(fileName)
		if (!pathExists(path)) {
			throw notFound("backup.not_found", `backup ${fileName} does not exist`, {
				fileName,
			})
		}
		return path
	}

	function snapshotRuntimeDb(destination: string): void {
		if (!vacuumSnapshotTo(db, destination)) {
			throw invalid(
				"backup.integrity_failed",
				"snapshot failed integrity check",
				{ destination },
			)
		}
		stripAuthFromSnapshot(destination)
	}

	function resolveBackupPath(
		fileName: string,
		options?: { readonly writable?: boolean },
	): string {
		const safe = assertSafeSegment(fileName)
		const currentDir = paths.latest.dbBackups()
		const currentCandidate = paths.latest.dbBackup(safe)
		assertInside(currentDir, currentCandidate)

		if (pathExists(currentCandidate)) {
			return currentCandidate
		}

		const currentSnapshotsDir = paths.latest.snapshots()
		const currentSnapshotCandidate = paths.latest.snapshot(safe)
		assertInside(currentSnapshotsDir, currentSnapshotCandidate)
		if (pathExists(currentSnapshotCandidate)) {
			return currentSnapshotCandidate
		}

		if (options?.writable) {
			// Writable operations must never touch a past version's frozen
			// archive. If the file lives only in a past version, report it
			// as archived read-only instead of silently returning a missing
			// path under current/.
			for (let v = 1; v < paths.latestVersion; v++) {
				const version = paths.atVersion(v)
				if (
					pathExists(version.dbBackup(safe)) ||
					pathExists(version.snapshot(safe))
				) {
					throw conflict(
						"backup.archived_readonly",
						`backup ${fileName} is stored in an archived version and cannot be restored or modified`,
						{ fileName },
					)
				}
			}
			return currentCandidate
		}

		// Read operations (restore, list) may locate backups that were left
		// behind in older versions, but they must not mutate them.
		for (let v = 1; v < paths.latestVersion; v++) {
			const version = paths.atVersion(v)
			const backupsDir = version.dbBackups()
			const backupCandidate = version.dbBackup(safe)
			if (pathExists(backupCandidate)) {
				assertInside(backupsDir, backupCandidate)
				return backupCandidate
			}
			const snapshotsDir = version.snapshots()
			const snapshotCandidate = version.snapshot(safe)
			if (pathExists(snapshotCandidate)) {
				assertInside(snapshotsDir, snapshotCandidate)
				return snapshotCandidate
			}
		}
		return currentCandidate
	}
}

function buildBackupName(ts: number): string {
	// Numeric-only timestamps sort lexicographically, which keeps listing
	// and restore UX ordered without extra parsing.
	return `${BACKUP_FILE_PREFIX}${ts}${BACKUP_FILE_SUFFIX}`
}

function buildAutoBackupName(ts: number): string {
	return `${AUTO_BACKUP_FILE_PREFIX}${ts}${BACKUP_FILE_SUFFIX}`
}

function isBackupFilename(name: string): boolean {
	return (
		name.startsWith(BACKUP_FILE_PREFIX) && name.endsWith(BACKUP_FILE_SUFFIX)
	)
}

function isAutoBackupFilename(name: string): boolean {
	return (
		name.startsWith(AUTO_BACKUP_FILE_PREFIX) &&
		name.endsWith(BACKUP_FILE_SUFFIX)
	)
}

/**
 * Local-date key (`YYYYMMDD`) of an auto snapshot filename, derived from
 * the embedded timestamp. `undefined` for names that do not carry one.
 */
function dateKeyOfAutoName(name: string): string | undefined {
	const match = /^auto-(\d+)\.sqlite$/.exec(name)
	if (match === null) return undefined
	const ts = Number(match[1])
	if (!Number.isFinite(ts)) return undefined
	const d = new Date(ts)
	return (
		String(d.getFullYear()) +
		String(d.getMonth() + 1).padStart(2, "0") +
		String(d.getDate()).padStart(2, "0")
	)
}

function isGeneratedBackupFilename(name: string): boolean {
	return isBackupFilename(name) || isAutoBackupFilename(name)
}

function summarise(path: string): BackupSummary {
	const stat = statSync(path)
	const meta = readBackupMeta(path)
	const versionDir = basename(dirname(dirname(path)))
	const inferredVersion = /^\d+$/.test(versionDir)
		? Number(versionDir)
		: undefined
	return {
		fileName: basename(path),
		kind: isAutoBackupFilename(basename(path)) ? "auto" : "manual",
		name: meta?.name,
		size: stat.size,
		createdAt: stat.mtimeMs,
		note: meta?.note,
		activeVersion: meta?.activeVersion ?? inferredVersion,
		counts:
			meta?.countResources !== undefined ||
			meta?.countCharacters !== undefined ||
			meta?.countDocuments !== undefined
				? {
						resources: meta?.countResources ?? 0,
						characters: meta?.countCharacters ?? 0,
						documents: meta?.countDocuments ?? 0,
					}
				: undefined,
	}
}

type BackupMeta = {
	readonly name?: string
	readonly note?: string
	readonly activeVersion?: number
	/** Live (non-trashed) entity counts recorded at snapshot time. */
	readonly countResources?: number
	readonly countCharacters?: number
	readonly countDocuments?: number
}

function backupMetaPath(backupPath: string): string {
	return `${backupPath}.meta.json`
}

const backupMetaSidecar = createSidecar<BackupMeta>({
	name: sidecarString,
	note: sidecarString,
	activeVersion: sidecarNumber(0),
	countResources: sidecarNumber(0),
	countCharacters: sidecarNumber(0),
	countDocuments: sidecarNumber(0),
})

function readBackupMeta(backupPath: string): BackupMeta | undefined {
	return backupMetaSidecar.read(backupMetaPath(backupPath))
}

function writeBackupMeta(backupPath: string, meta: BackupMeta): void {
	backupMetaSidecar.write(backupMetaPath(backupPath), meta)
}

function pathExists(path: string): boolean {
	try {
		statSync(path)
		return true
	} catch {
		return false
	}
}

/**
 * Backups are data, never credentials: drop the auth row from a freshly
 * written snapshot so a leaked or synced backup cannot expose password
 * material. Restores pair with this by never adopting a snapshot's auth
 * row either (see `applyPendingRestorePreservingAuth`).
 */
function stripAuthFromSnapshot(path: string): void {
	const handles = openDb(path)
	try {
		deleteAuthRow(handles.db)
	} finally {
		handles.close()
	}
}

type StageRestoreInput = {
	readonly paths: StoragePaths
	readonly source: string
	readonly dbFilePath: string
	readonly fileName: string
	readonly ts: number
}

/**
 * Copy the validated snapshot into `local/cache/tmp/` under a canonical name and
 * record a marker the next boot will act on. We copy via rename-onto-same-
 * volume when possible; falling back to `copyFileSync` keeps cross-volume
 * setups working.
 */
function stageRestore(input: StageRestoreInput): void {
	const { paths, source, dbFilePath, fileName, ts } = input
	const tmpDir = paths.local.tmp()
	mkdirSync(tmpDir, { recursive: true })
	const pending = paths.local.tmpFile(PENDING_RESTORE_FILENAME)
	// Always overwrite any prior pending file; the marker is what actually
	// gates whether the swap happens on next boot.
	rmSync(pending, { force: true })
	copyFile(source, pending)
	writePendingRestoreMarker({
		paths,
		marker: {
			pendingPath: pending,
			dbFilePath,
			sourceName: fileName,
			requestedAt: ts,
		},
	})
}

/** Canonical filename for the staged snapshot awaiting restore. */
const PENDING_RESTORE_FILENAME = "pending-restore.sqlite"

function copyFile(src: string, dest: string): void {
	copyFileSync(src, dest)
}

export const __testing__ = {
	PENDING_RESTORE_FILENAME,
	buildBackupName,
	buildAutoBackupName,
	isBackupFilename,
	isAutoBackupFilename,
	dateKeyOfAutoName,
}
