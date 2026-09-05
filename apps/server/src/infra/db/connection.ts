import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import BetterSqlite3 from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate } from "drizzle-orm/better-sqlite3/migrator"
import * as schema from "./schema.ts"

export type SqliteDb = ReturnType<typeof drizzle<typeof schema>>

/**
 * Drizzle transaction client passed to the callback of {@link withTransaction}.
 * Repository factories accept `SqliteDb | TxClient` so the same code can run
 * either outside or inside a transaction.
 */
export type TxClient = Parameters<Parameters<SqliteDb["transaction"]>[0]>[0]

/** Either the main DB handle or a transaction handle; both run Drizzle queries. */
export type DbClient = SqliteDb | TxClient

/**
 * Run `fn` inside a SQLite transaction. If `fn` throws, the transaction is
 * rolled back and the exception propagates. Better-sqlite3 transactions are
 * synchronous; this helper keeps the call site explicit.
 */
export function withTransaction<T>(db: SqliteDb, fn: (tx: TxClient) => T): T {
	return db.transaction(fn)
}

/**
 * Folder Drizzle Kit writes migrations to and the runtime migrator reads
 * them from. Next to this module in source (`src/infra/db/migrations`) and
 * in bundled entries (`dist/migrations`). Shared chunks live one directory
 * deeper (`dist/chunks/`), so the parent is the other candidate. The build
 * copies the folder to `dist/migrations` once; it does not duplicate it
 * beside every chunk.
 */
function resolveMigrationsFolder(): string {
	const beside = join(import.meta.dirname, "migrations")
	if (existsSync(beside)) return beside
	return join(import.meta.dirname, "..", "migrations")
}

export type DbHandles = {
	validateCompatibility?(): void
	readonly filePath?: string
	/**
	 * Drizzle query builder. **All** application and test queries go through
	 * this. Keep raw SQL isolated to the narrow helper methods on this handle.
	 */
	readonly db: SqliteDb
	/**
	 * Apply any pending migrations, in order, using the Drizzle Kit
	 * migrator. Bookkeeping lives in the `__drizzle_migrations` table that
	 * the migrator creates and maintains itself. Idempotent across calls.
	 */
	runMigrations(): void
	/**
	 * Write a consistent single-file snapshot of the live database to
	 * `destination` using SQLite's `VACUUM INTO`. Safe while the DB keeps
	 * serving other connections. The destination file must not already
	 * exist; SQLite enforces that.
	 *
	 * This is the only backup-related raw-SQL call in the codebase; keeping
	 * it here means the rest of the server never needs access to the raw
	 * handle.
	 */
	vacuumInto(destination: string): void
	/**
	 * Run `PRAGMA integrity_check` and return `true` when the result is the
	 * single row "ok". Used before accepting a snapshot as a restore source
	 * so we never hand the supervisor a corrupt file.
	 */
	integrityCheck(): boolean
	close(): void
}

/**
 * Open a SQLite database at the given URL. Returns a {@link DbHandles} that
 * exposes only the Drizzle query builder and a bound migration runner; the
 * underlying better-sqlite3 handle is intentionally kept private so callers
 * cannot accidentally sidestep the ORM.
 *
 * WAL + foreign keys are enabled; a 5 s busy timeout is set so concurrent
 * writers wait rather than fail immediately.
 */
export type OpenDbOptions = {
	/**
	 * Open the database file read-only. WAL mode is incompatible with
	 * read-only mode (it cannot create the WAL/SHM sidecars), so we keep
	 * the default `delete` journal mode in that case.
	 */
	readonly readonly?: boolean
}

/**
 * FNV-1a 32-bit hash, exposed to SQL as `hash(text)` so repositories can
 * express deterministic seed-based shuffling as
 * `ORDER BY hash(seed || id), id` — reproducible across queries for the
 * same seed, unlike `ORDER BY RANDOM()`.
 */
function fnv1a(value: string): number {
	let h = 0x811c9dc5
	for (let i = 0; i < value.length; i++) {
		h ^= value.charCodeAt(i)
		h = Math.imul(h, 0x01000193)
	}
	return h >>> 0
}

export function openDb(url: string, opts: OpenDbOptions = {}): DbHandles {
	const readonly = opts.readonly === true
	if (url !== ":memory:" && !readonly) {
		mkdirSync(dirname(url), { recursive: true })
	}
	const raw = readonly
		? new BetterSqlite3(url, { readonly: true, fileMustExist: true })
		: new BetterSqlite3(url)
	try {
		if (!readonly) {
			raw.pragma("journal_mode = WAL")
		}
		raw.pragma("foreign_keys = ON")
		raw.pragma("busy_timeout = 5000")
		raw.function("hash", { deterministic: true }, (value: unknown) =>
			fnv1a(String(value)),
		)
		const db = drizzle(raw, { schema })

		function runMigrations(): void {
			const folder = resolveMigrationsFolder()
			if (!existsSync(folder)) return
			migrate(db, { migrationsFolder: folder })
		}

		return {
			filePath: url,
			db,
			runMigrations,
			validateCompatibility() {
				const file = join(resolveMigrationsFolder(), "meta", "_journal.json")
				const journal: unknown = JSON.parse(readFileSync(file, "utf8"))
				if (
					!journal ||
					typeof journal !== "object" ||
					!("entries" in journal) ||
					!Array.isArray(journal.entries)
				)
					throw new Error("The application migration journal is invalid")
				const supported = Math.max(
					0,
					...journal.entries.map((entry: unknown) =>
						entry &&
						typeof entry === "object" &&
						"when" in entry &&
						typeof entry.when === "number"
							? entry.when
							: 0,
					),
				)
				const table = raw
					.prepare(
						"SELECT 1 FROM sqlite_master WHERE type='table' AND name='__drizzle_migrations'",
					)
					.get()
				if (table) {
					const row: unknown = raw
						.prepare(
							"SELECT MAX(created_at) AS applied FROM __drizzle_migrations",
						)
						.get()
					if (
						row &&
						typeof row === "object" &&
						"applied" in row &&
						typeof row.applied === "number" &&
						row.applied > supported
					)
						throw new Error(
							"This database requires a newer application version",
						)
				}
			},
			vacuumInto(destination: string): void {
				// `VACUUM INTO` cannot be parameterised; the destination is
				// single-quoted and any embedded quote is doubled per SQLite
				// string literal rules. Callers MUST have already validated
				// `destination` via `assertSafeSegment` + `assertInside`.
				const escaped = destination.replace(/'/g, "''")
				raw.exec(`VACUUM INTO '${escaped}'`)
			},
			integrityCheck(): boolean {
				const rows = raw.pragma("integrity_check") as ReadonlyArray<{
					integrity_check: string
				}>
				return rows.length === 1 && rows[0]?.integrity_check === "ok"
			},
			close: () => {
				if (raw.open) raw.close()
			},
		}
	} catch (error) {
		if (raw.open) raw.close()
		throw error
	}
}

export { schema }
