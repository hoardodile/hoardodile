/**
 * Structural storage migration: split host state out of an old-layout library.
 *
 * This is the "backup layout" conversion that the previous release shipped as
 * the offline `scripts/migrate-backup-layout.mjs` CLI. It converts an
 * unarchived, pre-versioning library (host tables inside the root `app.sqlite`,
 * `db-backups/` and `snapshots/` under `versions/1/`) into the current layout:
 * host state moves to `local/host.sqlite`, the legacy folders move into the
 * migration work directory, and the builtin `file` plugin is installed.
 *
 * It is now a synchronous runtime migration driven by the storage-format
 * framework (`migrations.ts`). The caller holds the instance lock; this module
 * never acquires one. It is resumable through
 * `local/backup-layout-migration/state.json` (`preparing → prepared →
 * complete`), so an interrupted boot resumes rather than redoing the work.
 *
 * Media stays in place (copy nothing, only move the two legacy folders). The
 * original database and legacy backups are preserved under the work directory.
 */

import { createHash } from "node:crypto"
import {
	cpSync,
	existsSync,
	lstatSync,
	mkdirSync,
	readdirSync,
	readFileSync,
	realpathSync,
	renameSync,
	rmSync,
	statfsSync,
	writeFileSync,
} from "node:fs"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import {
	hasPreRewriteTagSchema,
	runPreMigrationTagDedupe,
} from "src/domain/tag/dedupe.ts"
import { openDb, resolveMigrationsFolder } from "src/infra/db/connection.ts"

type Row = Record<string, unknown>

const BUILTIN_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
const HOST_TABLES = ["auth", "auth_sign_ins"]
const HOST_PREFS = ["sync.remindDays", "auth.sessionIdleTimeoutSeconds"]
const OLD_FOLDERS = ["db-backups", "snapshots"]
const WORK_NAME = "backup-layout-migration"
const MIGRATIONS = resolveMigrationsFolder()

export type BackupLayoutOptions = {
	readonly root: string
	readonly builtinDir: string
}

export type BackupLayoutInspection = {
	readonly root: string
	readonly work: string
	readonly phase?: string
	readonly database: string
	readonly databaseBytes: number
	readonly builtinDir: string
	readonly builtinTarget: string
	readonly builtinVersion: string
	readonly addBuiltin: boolean
	readonly pluginBytes: number
	readonly counts: Record<string, number>
	readonly schemaUpgradeRequired: boolean
	readonly migrated: boolean
}

type DatabaseHandle = BetterSqlite3.Database

function plain(path: string, kind: "directory" | "file") {
	const info = lstatSync(path)
	if (
		info.isSymbolicLink() ||
		(kind === "directory" ? !info.isDirectory() : !info.isFile()) ||
		(info.isFile() && info.nlink !== 1)
	)
		throw new Error(`Expected an independent ${kind}: ${path}`)
	return info
}

function treeBytes(path: string): number {
	const info = lstatSync(path)
	if (info.isDirectory() && !info.isSymbolicLink())
		return readdirSync(path).reduce(
			(total, name) => total + treeBytes(join(path, name)),
			0,
		)
	return plain(path, "file").size
}

function json(path: string): Record<string, unknown> {
	return JSON.parse(readFileSync(path, "utf8")) as Record<string, unknown>
}

function writeState(work: string, phase: string): void {
	const temp = join(work, "state.next.json")
	writeFileSync(temp, JSON.stringify({ format: 1, phase }), { mode: 0o600 })
	renameSync(temp, join(work, "state.json"))
}

function readState(work: string): string | undefined {
	if (!existsSync(work)) return undefined
	plain(work, "directory")
	plain(join(work, "state.json"), "file")
	const state = json(join(work, "state.json"))
	if (
		state.format !== 1 ||
		!["preparing", "prepared", "complete"].includes(String(state.phase))
	)
		throw new Error("Unrecognized migration state; preserve it for inspection")
	return state.phase as string
}

/**
 * Classify a library schema against the current migration journal.
 * `"current"` matches the journal exactly. `"legacy"` is at least through the
 * migration that introduces the host tables and a strict prefix of the
 * journal — e.g. a v0.1.15 database, exactly one migration behind. `"future"`
 * means the database was created by a newer application; anything else is
 * `"unknown"`. Only `"current"` and `"legacy"` are supported here; `"legacy"`
 * is upgraded in place during apply.
 */
function schemaKind(
	db: DatabaseHandle,
): "current" | "legacy" | "future" | "unknown" {
	const applied = db
		.prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at")
		.all() as Array<{ created_at: number }>
	const journal = json(join(MIGRATIONS, "meta", "_journal.json"))
	const expected = Array.isArray(journal.entries)
		? (journal.entries as Array<{ when: number }>)
		: []
	const isPrefix = (length: number) =>
		applied.length === length &&
		applied.every((entry, index) => entry.created_at === expected[index]?.when)
	if (isPrefix(expected.length)) return "current"
	if (
		applied.length < expected.length &&
		applied.length >= 2 &&
		isPrefix(applied.length)
	)
		return "legacy"
	return applied.length > expected.length ? "future" : "unknown"
}

function checkDatabase(db: DatabaseHandle): "current" | "legacy" {
	const result = db.pragma("integrity_check") as Array<{
		integrity_check: string
	}>
	if (result.length !== 1 || result[0]?.integrity_check !== "ok")
		throw new Error("Database integrity check failed")
	if ((db.pragma("foreign_key_check") as unknown[]).length)
		throw new Error("Database contains broken foreign keys")
	const kind = schemaKind(db)
	if (kind === "future")
		throw new Error("This database requires a newer application version")
	if (kind === "unknown")
		throw new Error(
			"Database schema is not current. This tool upgrades only an unarchived library at the supported legacy schema (e.g. v0.1.15)",
		)
	return kind
}

function hostRecords(db: DatabaseHandle): Record<string, Row[]> {
	return Object.fromEntries([
		...HOST_TABLES.map((table) => [
			table,
			db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all() as Row[],
		]),
		[
			"system_preferences",
			db
				.prepare(
					"SELECT * FROM system_preferences WHERE key IN (?, ?) ORDER BY key",
				)
				.all(...HOST_PREFS) as Row[],
		],
	]) as Record<string, Row[]>
}

function schemaDigest(db: DatabaseHandle): string {
	return createHash("sha256")
		.update(
			JSON.stringify(
				db
					.prepare(
						"SELECT name, sql FROM sqlite_master WHERE type IN ('table', 'index', 'trigger') AND name NOT LIKE 'sqlite_%' ORDER BY name",
					)
					.all(),
			),
		)
		.digest("hex")
}

/** Validate an old-layout library without mutating it or creating files. */
export function inspectBackupLayout(
	options: BackupLayoutOptions,
): BackupLayoutInspection {
	const root = realpathSync(resolve(options.root))
	plain(root, "directory")
	// A minimal v0.1.15 library may have no `local/` and no `versions/1/plugins/`.
	for (const name of ["versions", "versions/1"])
		plain(join(root, name), "directory")
	for (const name of ["local", "versions/1/plugins"])
		if (existsSync(join(root, name))) plain(join(root, name), "directory")
	const work = join(root, "local", WORK_NAME)
	const phase = readState(work)
	if (existsSync(join(root, "local/host.sqlite"))) {
		plain(join(root, "local/host.sqlite"), "file")
		return {
			root,
			work,
			phase,
			migrated: true,
			database: join(root, "app.sqlite"),
			databaseBytes: 0,
			builtinDir: "",
			builtinTarget: join(root, "versions/1/plugins", BUILTIN_ID),
			builtinVersion: "",
			addBuiltin: false,
			pluginBytes: 0,
			counts: {},
			schemaUpgradeRequired: false,
		}
	}
	const versions = readdirSync(join(root, "versions")).filter((name) =>
		/^[1-9][0-9]*$/.test(name),
	)
	if (
		versions.length !== 1 ||
		versions[0] !== "1" ||
		existsSync(join(root, "versions/1/app.sqlite"))
	)
		throw new Error(
			"This tool requires one writable versions/1 and no frozen archives. Historical plugin builds must be handled explicitly",
		)
	for (const name of [
		"protection",
		"replication",
		"archive-publication",
		"checkpoint-publication",
		"plugin-installations",
	])
		if (existsSync(join(root, "local", name)))
			throw new Error(`Resolve existing ${name} state before migration`)
	const statePath = join(root, "local/version-state.json")
	if (existsSync(statePath)) {
		plain(statePath, "file")
		if (json(statePath).active !== 1)
			throw new Error("Select the current writable version before migrating")
	}
	if (existsSync(join(root, "versions/1/checkpoint")))
		throw new Error("An existing checkpoint requires manual inspection")
	const database = join(root, "app.sqlite")
	const databaseBytes = plain(database, "file").size
	for (const suffix of ["-wal", "-shm", "-journal"])
		if (existsSync(database + suffix)) plain(database + suffix, "file")
	const builtinDir = realpathSync(resolve(options.builtinDir))
	const location = relative(root, builtinDir)
	if (
		location === "" ||
		(!isAbsolute(location) &&
			location !== ".." &&
			!location.startsWith(`..${sep}`))
	)
		throw new Error("The builtin source must be outside the storage root")
	plain(builtinDir, "directory")
	plain(join(builtinDir, "manifest.json"), "file")
	plain(join(builtinDir, "main.js"), "file")
	const builtinManifest = json(join(builtinDir, "manifest.json"))
	if (
		builtinManifest.id !== BUILTIN_ID ||
		typeof builtinManifest.version !== "string"
	)
		throw new Error("The supplied directory is not the built File plugin")
	const builtinTarget = join(root, "versions/1/plugins", BUILTIN_ID)
	const addBuiltin = !existsSync(builtinTarget)
	const pluginsDir = join(root, "versions/1/plugins")
	let pluginBytes = existsSync(pluginsDir) ? treeBytes(pluginsDir) : 0
	if (addBuiltin) pluginBytes += treeBytes(builtinDir)
	for (const name of OLD_FOLDERS) {
		const source = join(root, "versions/1", name)
		const saved = join(work, name)
		if (existsSync(source)) plain(source, "directory")
		if (existsSync(saved)) plain(saved, "directory")
		if (existsSync(source) && existsSync(saved))
			throw new Error(
				`Both original and saved ${name} exist; inspect them first`,
			)
	}
	const db = new BetterSqlite3(database, {
		readonly: true,
		fileMustExist: true,
	})
	try {
		const schema = checkDatabase(db)
		for (const row of db
			.prepare("SELECT id FROM content_plugins WHERE missing = 0")
			.all() as Row[]) {
			if (!/^[a-zA-Z0-9-]+$/.test(String(row.id)))
				throw new Error("Unsafe plugin ID")
			const directory =
				row.id === BUILTIN_ID && addBuiltin
					? builtinDir
					: join(root, "versions/1/plugins", String(row.id))
			plain(join(directory, "manifest.json"), "file")
			plain(join(directory, "main.js"), "file")
			if (json(join(directory, "manifest.json")).id !== row.id)
				throw new Error(`Plugin manifest ID mismatch: ${row.id}`)
		}
		return {
			root,
			work,
			phase,
			database,
			databaseBytes,
			builtinDir,
			builtinTarget,
			builtinVersion: String(builtinManifest.version),
			addBuiltin,
			pluginBytes,
			counts: Object.fromEntries(
				Object.entries(hostRecords(db)).map(([table, rows]) => [
					table,
					rows.length,
				]),
			),
			schemaUpgradeRequired: schema === "legacy",
			migrated: false,
		}
	} finally {
		db.close()
	}
}

function removeStaged(path: string): void {
	if (existsSync(path)) {
		treeBytes(path)
		rmSync(path, { recursive: true })
	}
	if (path.endsWith(".sqlite"))
		for (const suffix of ["-wal", "-shm", "-journal"]) {
			const sidecar = path + suffix
			if (existsSync(sidecar)) {
				plain(sidecar, "file")
				rmSync(sidecar)
			}
		}
}

/** Bring a legacy library schema current (with the pre-migration tag dedupe). */
function upgradeDatabase(path: string): void {
	const handles = openDb(path)
	try {
		if (hasPreRewriteTagSchema(handles.db))
			runPreMigrationTagDedupe(handles.db, { dryRun: false })
		handles.runMigrations()
	} finally {
		handles.close()
	}
}

/**
 * Convert an old-layout library to the current layout. Idempotent and
 * resumable; returns the completed inspection (or the already-migrated one).
 * The caller must hold the instance lock. Throws (leaving the library
 * unchanged) when the library is unsupported.
 */
export function applyBackupLayout(
	options: BackupLayoutOptions,
): BackupLayoutInspection & { phase: "complete" } {
	const initial = inspectBackupLayout(options)
	if (initial.migrated)
		return { ...initial, phase: (initial.phase ?? "complete") as "complete" }
	const plan = inspectBackupLayout(options)
	if (plan.migrated)
		return { ...plan, phase: (plan.phase ?? "complete") as "complete" }
	const disk = statfsSync(plan.root)
	if (
		disk.bavail * disk.bsize <
		plan.databaseBytes * 3 + plan.pluginBytes + 64 * 1024 * 1024
	)
		throw new Error("Insufficient free space for migration working copies")
	if (!plan.phase) {
		mkdirSync(plan.work, { recursive: true })
		writeState(plan.work, "preparing")
	}
	const original = join(plan.work, "original.sqlite")
	if (!plan.phase || plan.phase === "preparing") {
		// Bring a legacy schema current before snapshotting so the saved copy and
		// the live library compare like to like. Idempotent, safe to re-run.
		if (plan.schemaUpgradeRequired) upgradeDatabase(plan.database)
		const next = join(plan.work, "original.next.sqlite")
		removeStaged(next)
		const source = openDb(plan.database)
		try {
			source.vacuumInto(next)
		} finally {
			source.close()
		}
		if (existsSync(original)) plain(original, "file")
		renameSync(next, original)
		writeState(plan.work, "prepared")
	}
	plain(original, "file")
	const saved = new BetterSqlite3(original, {
		readonly: true,
		fileMustExist: true,
	})
	const live: DatabaseHandle = new BetterSqlite3(plan.database, {
		fileMustExist: true,
		timeout: 0,
	})
	const closeWith = (handle: DatabaseHandle) => {
		try {
			handle.close()
		} catch {
			// Already closed.
		}
	}
	try {
		const savedKind = checkDatabase(saved)
		const liveKind = checkDatabase(live)
		if (savedKind !== "current" || liveKind !== "current")
			throw new Error(
				"The library schema could not be upgraded; preserve both databases",
			)
		if (schemaDigest(saved) !== schemaDigest(live))
			throw new Error("The library schema changed since migration was prepared")
		const records = hostRecords(saved)
		for (const [table, rows] of Object.entries(hostRecords(live)))
			if (
				rows.length &&
				JSON.stringify(rows) !== JSON.stringify(records[table])
			)
				throw new Error(
					"Host records changed after migration started; preserve both databases",
				)
		const hostPath = join(plan.work, "host.next.sqlite")
		removeStaged(hostPath)
		const host = new BetterSqlite3(hostPath)
		try {
			migrate(drizzle(host), { migrationsFolder: MIGRATIONS })
			host.transaction(() => {
				for (const [table, rows] of Object.entries(records))
					for (const row of rows) {
						const keys = Object.keys(row)
						host
							.prepare(
								`INSERT INTO "${table}" (${keys
									.map((key) => `"${key.replaceAll('"', '""')}"`)
									.join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
							)
							.run(...Object.values(row))
					}
			})()
			checkDatabase(host)
		} finally {
			host.close()
		}
		if (plan.addBuiltin) {
			mkdirSync(join(plan.root, "versions/1/plugins"), { recursive: true })
			const plugin = join(plan.work, "builtin.next")
			removeStaged(plugin)
			cpSync(plan.builtinDir, plugin, {
				recursive: true,
				preserveTimestamps: true,
			})
			treeBytes(plugin)
			renameSync(plugin, plan.builtinTarget)
		}
		for (const name of OLD_FOLDERS) {
			const source = join(plan.root, "versions/1", name)
			if (existsSync(source)) renameSync(source, join(plan.work, name))
		}
		live.pragma("secure_delete = ON")
		live.transaction(() => {
			for (const table of [...HOST_TABLES].reverse())
				live.exec(`DELETE FROM "${table}"`)
			live
				.prepare("DELETE FROM system_preferences WHERE key IN (?, ?)")
				.run(...HOST_PREFS)
		})()
		checkDatabase(live)
		renameSync(hostPath, join(plan.root, "local/host.sqlite"))
		writeState(plan.work, "complete")
		return { ...plan, migrated: true, phase: "complete" }
	} finally {
		closeWith(live)
		closeWith(saved)
	}
}
