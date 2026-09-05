#!/usr/bin/env node
/**
 * Offline, one-time conversion of an unarchived library to separate host state.
 * Defaults to inspection. Stop the service before adding --apply. Media stays
 * in place; the original database and old SQL backups remain under local/.
 * Frozen archives require their original plugin builds and are refused here.
 *
 * node scripts/migrate-backup-layout.mjs <storageRoot> [--apply]
 *   [--builtin-dir <built-file-plugin-directory>]
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
import { createRequire } from "node:module"
import { isAbsolute, join, relative, resolve, sep } from "node:path"
import { pathToFileURL } from "node:url"
import { WORKSPACE_ROOT } from "./lib/workspace.mjs"

const require = createRequire(join(WORKSPACE_ROOT, "apps/server/package.json"))
const Database = require("better-sqlite3")
const { drizzle } = require("drizzle-orm/better-sqlite3")
const { migrate } = require("drizzle-orm/better-sqlite3/migrator")
const MIGRATIONS = join(WORKSPACE_ROOT, "apps/server/src/infra/db/migrations")
const BUILTIN_ID = "a1b2c3d4-e5f6-7890-abcd-ef1234567890"
const HOST_TABLES = ["auth", "auth_sign_ins", "sync_devices", "sync_records"]
const HOST_PREFS = ["sync.remindDays", "auth.sessionIdleTimeoutSeconds"]
const OLD_FOLDERS = ["db-backups", "snapshots"]
const WORK_NAME = "backup-layout-migration"

function plain(path, kind) {
	const info = lstatSync(path)
	if (
		info.isSymbolicLink() ||
		(kind === "directory" ? !info.isDirectory() : !info.isFile()) ||
		(info.isFile() && info.nlink !== 1)
	)
		throw new Error(`Expected an independent ${kind}: ${path}`)
	return info
}

function treeBytes(path) {
	const info = lstatSync(path)
	if (info.isDirectory() && !info.isSymbolicLink())
		return readdirSync(path).reduce(
			(total, name) => total + treeBytes(join(path, name)),
			0,
		)
	return plain(path, "file").size
}

function json(path) {
	return JSON.parse(readFileSync(path, "utf8"))
}

function writeState(work, phase) {
	const temp = join(work, "state.next.json")
	writeFileSync(temp, JSON.stringify({ format: 1, phase }), { mode: 0o600 })
	renameSync(temp, join(work, "state.json"))
}

function readState(work) {
	if (!existsSync(work)) return undefined
	plain(work, "directory")
	plain(join(work, "state.json"), "file")
	const state = json(join(work, "state.json"))
	if (
		state.format !== 1 ||
		!["preparing", "prepared", "complete"].includes(state.phase)
	)
		throw new Error("Unrecognized migration state; preserve it for inspection")
	return state.phase
}

function checkDatabase(db) {
	const result = db.pragma("integrity_check")
	if (result.length !== 1 || result[0].integrity_check !== "ok")
		throw new Error("Database integrity check failed")
	if (db.pragma("foreign_key_check").length)
		throw new Error("Database contains broken foreign keys")
	const applied = db
		.prepare("SELECT created_at FROM __drizzle_migrations ORDER BY created_at")
		.all()
	const expected = json(join(MIGRATIONS, "meta/_journal.json")).entries
	if (
		applied.length !== expected.length ||
		applied.some((entry, index) => entry.created_at !== expected[index].when)
	)
		throw new Error(
			"Database schema is not current. This tool does not upgrade database schemas",
		)
}

function hostRecords(db) {
	return Object.fromEntries([
		...HOST_TABLES.map((table) => [
			table,
			db.prepare(`SELECT * FROM "${table}" ORDER BY rowid`).all(),
		]),
		[
			"system_preferences",
			db
				.prepare(
					"SELECT * FROM system_preferences WHERE key IN (?, ?) ORDER BY key",
				)
				.all(...HOST_PREFS),
		],
	])
}

function schemaDigest(db) {
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

/** Inspection never opens the source for writing or creates files in its root. */
export function inspectBackupLayout(options) {
	const root = realpathSync(resolve(options.root))
	plain(root, "directory")
	for (const name of ["local", "versions", "versions/1", "versions/1/plugins"])
		plain(join(root, name), "directory")
	const work = join(root, "local", WORK_NAME)
	const phase = readState(work)
	if (existsSync(join(root, "local/host.sqlite"))) {
		plain(join(root, "local/host.sqlite"), "file")
		return { root, work, phase, migrated: true }
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
	const builtinDir = realpathSync(
		resolve(options.builtinDir ?? join(WORKSPACE_ROOT, "plugins/file/dist")),
	)
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
	let pluginBytes = treeBytes(join(root, "versions/1/plugins"))
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
	const db = new Database(database, { readonly: true, fileMustExist: true })
	try {
		checkDatabase(db)
		for (const row of db
			.prepare("SELECT id FROM content_plugins WHERE missing = 0")
			.all()) {
			if (!/^[a-zA-Z0-9-]+$/.test(row.id)) throw new Error("Unsafe plugin ID")
			const directory =
				row.id === BUILTIN_ID && addBuiltin
					? builtinDir
					: join(root, "versions/1/plugins", row.id)
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
			builtinVersion: builtinManifest.version,
			addBuiltin,
			pluginBytes,
			counts: Object.fromEntries(
				Object.entries(hostRecords(db)).map(([table, rows]) => [
					table,
					rows.length,
				]),
			),
			migrated: false,
		}
	} finally {
		db.close()
	}
}

function acquireLock(root) {
	const path = join(root, "local/instance-lock.sqlite")
	if (existsSync(path)) plain(path, "file")
	const db = new Database(path, { timeout: 0 })
	try {
		db.pragma("journal_mode = DELETE")
		db.exec("CREATE TABLE IF NOT EXISTS instance_lock (id INTEGER PRIMARY KEY)")
		db.exec("BEGIN EXCLUSIVE")
		return () => db.close()
	} catch {
		db.close()
		throw new Error("Stop the server and desktop app before applying migration")
	}
}

function removeStaged(path) {
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

/** Publish host.sqlite last so the new runtime cannot open a partial conversion. */
export async function applyBackupLayout(options) {
	const initial = inspectBackupLayout(options)
	if (initial.migrated) return initial
	const unlock = acquireLock(initial.root)
	try {
		const plan = inspectBackupLayout(options)
		if (plan.migrated) return plan
		const disk = statfsSync(plan.root)
		if (
			disk.bavail * disk.bsize <
			plan.databaseBytes * 3 + plan.pluginBytes + 64 * 1024 * 1024
		)
			throw new Error("Insufficient free space for migration working copies")
		if (!plan.phase) {
			mkdirSync(plan.work)
			writeState(plan.work, "preparing")
		}
		const original = join(plan.work, "original.sqlite")
		if (!plan.phase || plan.phase === "preparing") {
			const next = join(plan.work, "original.next.sqlite")
			removeStaged(next)
			const source = new Database(plan.database, {
				readonly: true,
				fileMustExist: true,
			})
			try {
				await source.backup(next)
			} finally {
				source.close()
			}
			if (existsSync(original)) plain(original, "file")
			renameSync(next, original)
			writeState(plan.work, "prepared")
		}
		plain(original, "file")
		const saved = new Database(original, {
			readonly: true,
			fileMustExist: true,
		})
		const live = new Database(plan.database, {
			fileMustExist: true,
			timeout: 0,
		})
		try {
			checkDatabase(saved)
			checkDatabase(live)
			if (schemaDigest(saved) !== schemaDigest(live))
				throw new Error(
					"The library schema changed since migration was prepared",
				)
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
			const host = new Database(hostPath)
			try {
				migrate(drizzle(host), { migrationsFolder: MIGRATIONS })
				host.transaction(() => {
					for (const [table, rows] of Object.entries(records))
						for (const row of rows) {
							const keys = Object.keys(row)
							host
								.prepare(
									`INSERT INTO "${table}" (${keys.map((key) => `"${key.replaceAll('"', '""')}"`).join(",")}) VALUES (${keys.map(() => "?").join(",")})`,
								)
								.run(...Object.values(row))
						}
				})()
				checkDatabase(host)
			} finally {
				host.close()
			}
			if (plan.addBuiltin) {
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
			live.close()
			saved.close()
		}
	} finally {
		unlock()
	}
}

async function main(argv) {
	const root = argv.shift()
	if (!root || root.startsWith("-"))
		throw new Error(
			"Usage: node scripts/migrate-backup-layout.mjs <storageRoot> [--apply] [--builtin-dir <directory>]",
		)
	const options = { root }
	let apply = false
	while (argv.length) {
		const arg = argv.shift()
		if (arg === "--apply") apply = true
		else if (arg === "--dry-run") continue
		else if (arg === "--builtin-dir" && argv[0] && !argv[0].startsWith("-"))
			options.builtinDir = argv.shift()
		else throw new Error(`Unknown or incomplete argument: ${arg}`)
	}
	const plan = apply
		? await applyBackupLayout(options)
		: inspectBackupLayout(options)
	console.log(JSON.stringify(plan, null, 2))
	console.log(
		plan.migrated
			? "Separate host state is present. Original migration files, if any, remain under local/backup-layout-migration."
			: "Inspection only; no files changed. Stop the service, then repeat with --apply. Resources are not copied. This tool accepts only an unarchived, current-schema library.",
	)
}

if (
	process.argv[1] &&
	import.meta.url === pathToFileURL(resolve(process.argv[1])).href
)
	main(process.argv.slice(2)).catch((error) => {
		console.error(error.message)
		process.exitCode = 1
	})
