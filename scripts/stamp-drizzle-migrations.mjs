#!/usr/bin/env node
/**
 * Stamp `__drizzle_migrations` on an existing library whose schema already
 * matches the current Drizzle baseline. Used after squashing the SQL
 * history: the live tables are already in place, so applying `0000_*.sql`
 * would fail on `CREATE TABLE`. This writes the journal hashes Drizzle's
 * migrator compares against and does not run any migration SQL.
 *
 * Stop the server before running. Fresh empty databases should start the
 * server instead — the migrator creates the schema there.
 *
 * Usage:
 *   node scripts/stamp-drizzle-migrations.mjs <storageRoot> [--dry-run]
 */
import { createHash } from "node:crypto"
import { existsSync, readFileSync, statSync } from "node:fs"
import { join, resolve } from "node:path"
import { DatabaseSync } from "node:sqlite"
import { WORKSPACE_ROOT } from "./lib/workspace.mjs"

const MIGRATIONS_FOLDER = join(
	WORKSPACE_ROOT,
	"apps",
	"server",
	"src",
	"infra",
	"db",
	"migrations",
)
const JOURNAL_PATH = join(MIGRATIONS_FOLDER, "meta", "_journal.json")
const BOOKKEEPING_TABLE = "__drizzle_migrations"

/**
 * Mirror of `readMigrationFiles` in drizzle-orm: sha256 of each journal
 * SQL file, plus the journal `when` that the migrator stores as
 * `created_at`. Pending work is "folderMillis newer than last row".
 */
function readJournalMigrations() {
	if (!existsSync(JOURNAL_PATH)) {
		throw new Error(`Can't find ${JOURNAL_PATH}`)
	}
	const journal = JSON.parse(readFileSync(JOURNAL_PATH, "utf8"))
	const migrations = []
	for (const entry of journal.entries) {
		const sqlPath = join(MIGRATIONS_FOLDER, `${entry.tag}.sql`)
		const query = readFileSync(sqlPath).toString()
		migrations.push({
			tag: entry.tag,
			folderMillis: entry.when,
			hash: createHash("sha256").update(query).digest("hex"),
			sql: query,
		})
	}
	return migrations
}

function expectedTables(migrations) {
	const names = new Set()
	const re = /CREATE TABLE(?: IF NOT EXISTS)? `([^`]+)`/g
	for (const migration of migrations) {
		re.lastIndex = 0
		let match = re.exec(migration.sql)
		while (match !== null) {
			const name = match[1]
			if (!name.startsWith("__new_")) names.add(name)
			match = re.exec(migration.sql)
		}
	}
	return [...names].sort()
}

function parseArgs(argv) {
	const root = argv[0]
	if (root === undefined || root.startsWith("-")) {
		console.error(
			"usage: node scripts/stamp-drizzle-migrations.mjs <storageRoot> [--dry-run]",
		)
		process.exit(2)
	}
	let dryRun = false
	for (let i = 1; i < argv.length; i += 1) {
		if (argv[i] === "--dry-run") {
			dryRun = true
		} else {
			console.error(`unknown argument: ${argv[i]}`)
			process.exit(2)
		}
	}
	return { root: resolve(root), dryRun }
}

function openLiveDb(root) {
	const dbPath = join(root, "app.sqlite")
	if (!existsSync(dbPath)) {
		console.error(`live database not found: ${dbPath}`)
		process.exit(2)
	}
	return { dbPath, db: new DatabaseSync(dbPath) }
}

function tableNames(db) {
	const rows = db
		.prepare(
			"SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'",
		)
		.all()
	return new Set(rows.map((row) => row.name))
}

function currentMarkers(db) {
	if (!tableNames(db).has(BOOKKEEPING_TABLE)) return []
	return db
		.prepare(
			`SELECT hash, created_at AS createdAt FROM "${BOOKKEEPING_TABLE}" ORDER BY created_at, id`,
		)
		.all()
		.map((row) => ({
			hash: String(row.hash),
			createdAt: Number(row.createdAt),
		}))
}

function markersMatch(current, migrations) {
	if (current.length !== migrations.length) return false
	return current.every(
		(row, i) =>
			row.hash === migrations[i].hash &&
			row.createdAt === migrations[i].folderMillis,
	)
}

function missingTables(present, expected) {
	return expected.filter((name) => !present.has(name))
}

function stamp(db, migrations) {
	db.exec(`
		CREATE TABLE IF NOT EXISTS "${BOOKKEEPING_TABLE}" (
			id SERIAL PRIMARY KEY,
			hash text NOT NULL,
			created_at numeric
		)
	`)
	db.exec("BEGIN")
	try {
		db.exec(`DELETE FROM "${BOOKKEEPING_TABLE}"`)
		const insert = db.prepare(
			`INSERT INTO "${BOOKKEEPING_TABLE}" ("hash", "created_at") VALUES (?, ?)`,
		)
		for (const migration of migrations) {
			insert.run(migration.hash, migration.folderMillis)
		}
		db.exec("COMMIT")
	} catch (error) {
		db.exec("ROLLBACK")
		throw error
	}
}

function main() {
	const { root, dryRun } = parseArgs(process.argv.slice(2))
	if (!existsSync(root) || !statSync(root).isDirectory()) {
		console.error(`storage root not found: ${root}`)
		process.exit(2)
	}

	const migrations = readJournalMigrations()
	if (migrations.length === 0) {
		console.error("no journal entries in the Drizzle migrations folder")
		process.exit(1)
	}
	const expected = expectedTables(migrations)
	const { dbPath, db } = openLiveDb(root)
	try {
		const present = tableNames(db)
		const missing = missingTables(present, expected)
		if (missing.length > 0) {
			console.error(
				`schema is not aligned with the current baseline; missing tables:\n  ${missing.join("\n  ")}`,
			)
			console.error("refusing to stamp — apply a real schema migration first")
			process.exit(1)
		}

		const current = currentMarkers(db)
		const tags = migrations.map((m) => m.tag).join(", ")
		if (markersMatch(current, migrations)) {
			console.log(`already aligned: ${dbPath} (${tags})`)
			return
		}

		if (dryRun) {
			console.log(
				`would stamp ${dbPath}: ${migrations.length} marker(s) [${tags}] (was ${current.length})`,
			)
			return
		}

		stamp(db, migrations)
		console.log(
			`stamped ${dbPath}: ${migrations.length} marker(s) [${tags}] (was ${current.length})`,
		)
	} finally {
		db.close()
	}
}

main()
