import { createHash } from "node:crypto"
import {
	copyFile,
	link,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import Database from "better-sqlite3"
import { drizzle } from "drizzle-orm/better-sqlite3"
import { migrate as drizzleMigrate } from "drizzle-orm/better-sqlite3/migrator"
import { loadEnv } from "src/config/env.ts"
import { hashPassword } from "src/domain/auth/password.ts"
import { getAuthRow, setAuthRow } from "src/domain/auth/repo.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import {
	applyBackupLayout,
	inspectBackupLayout,
} from "src/infra/storage/backup-layout.ts"
import { acquireStorageInstance } from "src/infra/storage/instance-lock.ts"
import { isOldLayoutLibrary } from "src/infra/storage/migrations.ts"
import { readStorageFormat } from "src/infra/storage/storage-format.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, expect, it } from "vitest"

const builtin = fileURLToPath(
	new URL("../../../../../plugins/file/dist/", import.meta.url),
)
const roots: string[] = []
let built: BuiltServer | undefined

const envFor = (root: string) =>
	loadEnv({
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
		STORAGE_ROOT: root,
		DISABLE_DEV_PLUGINS: "true",
	})

afterEach(async () => {
	await built?.close()
	built = undefined
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true })
})

async function fixture(options: { local?: boolean; plugins?: boolean } = {}) {
	const { local = true, plugins = true } = options
	const root = await mkdtemp(join(tmpdir(), "backup-layout-migration-"))
	roots.push(root)
	if (local) await mkdir(join(root, "local"))
	if (plugins)
		await mkdir(join(root, "versions/1/plugins"), { recursive: true })
	await mkdir(join(root, "versions/1"), { recursive: true })
	await mkdir(join(root, "versions/.stfolder"))
	for (const folder of ["db-backups", "snapshots"])
		await mkdir(join(root, "versions/1", folder))
	await mkdir(join(root, "versions/1/resources/resource/data"), {
		recursive: true,
	})
	await writeFile(
		join(root, "versions/1/resources/resource/data/media.bin"),
		"unchanged-media",
	)
	await writeFile(join(root, "versions/1/db-backups/old.sqlite"), "old-backup")
	await writeFile(
		join(root, "versions/1/snapshots/auto.sqlite"),
		"old-snapshot",
	)
	if (local)
		await writeFile(
			join(root, "local/.session-key"),
			Buffer.alloc(32, 5).toString("base64"),
		)
	const db = openDb(join(root, "app.sqlite"))
	db.runMigrations()
	setAuthRow(db.db, {
		hash: await hashPassword("migration-password"),
		updatedAt: 1,
		weakPassword: false,
	})
	db.db
		.insert(schema.systemPreferences)
		.values([
			{ key: "theme", value: '"dark"', updatedAt: 1 },
			{ key: "sync.remindDays", value: "14", updatedAt: 1 },
		])
		.run()
	db.close()
	return root
}

/**
 * Rebuild the v0.1.15 migration journal: identical migration files 0000–0004
 * and a journal truncated to exactly those entries. The stored `when`
 * timestamps equal the first five entries of the current journal, so the
 * produced database is a strict prefix (one migration, 0005, behind) that the
 * migration tool must upgrade in place.
 */
async function writeLegacyMigrations(dir: string) {
	const source = new URL("../db/migrations/", import.meta.url)
	for (const name of [
		"0000_nosy_forgotten_one.sql",
		"0001_aberrant_tigra.sql",
		"0002_orange_lady_bullseye.sql",
		"0003_even_night_nurse.sql",
		"0004_thin_fixer.sql",
	]) {
		await copyFile(join(fileURLToPath(source), name), join(dir, name))
	}
	await mkdir(join(dir, "meta"), { recursive: true })
	const journal = JSON.parse(
		await readFile(join(fileURLToPath(source), "meta/_journal.json"), "utf8"),
	) as { entries: ReadonlyArray<{ when: number }> }
	journal.entries = journal.entries.slice(0, 5)
	await writeFile(
		join(dir, "meta/_journal.json"),
		JSON.stringify(journal, null, "\t"),
	)
}

/** Same layout as {@link fixture} but with a genuine v0.1.15 (one-behind) schema. */
async function legacyFixture(
	options: { local?: boolean; plugins?: boolean } = {},
) {
	const { local = true, plugins = true } = options
	const root = await mkdtemp(join(tmpdir(), "backup-layout-legacy-"))
	roots.push(root)
	if (local) await mkdir(join(root, "local"))
	if (plugins)
		await mkdir(join(root, "versions/1/plugins"), { recursive: true })
	await mkdir(join(root, "versions/1"), { recursive: true })
	await mkdir(join(root, "versions/.stfolder"))
	for (const folder of ["db-backups", "snapshots"])
		await mkdir(join(root, "versions/1", folder))
	await mkdir(join(root, "versions/1/resources/resource/data"), {
		recursive: true,
	})
	await writeFile(
		join(root, "versions/1/resources/resource/data/media.bin"),
		"unchanged-media",
	)
	await writeFile(join(root, "versions/1/db-backups/old.sqlite"), "old-backup")
	await writeFile(
		join(root, "versions/1/snapshots/auto.sqlite"),
		"old-snapshot",
	)
	if (local)
		await writeFile(
			join(root, "local/.session-key"),
			Buffer.alloc(32, 5).toString("base64"),
		)
	const legacyMigrations = await mkdtemp(
		join(tmpdir(), "backup-layout-migrations-"),
	)
	roots.push(legacyMigrations)
	await writeLegacyMigrations(legacyMigrations)
	const raw = new Database(join(root, "app.sqlite"))
	try {
		drizzleMigrate(drizzle(raw), { migrationsFolder: legacyMigrations })
	} finally {
		raw.close()
	}
	const db = openDb(join(root, "app.sqlite"))
	setAuthRow(db.db, {
		hash: await hashPassword("migration-password"),
		updatedAt: 1,
		weakPassword: false,
	})
	db.db
		.insert(schema.systemPreferences)
		.values([
			{ key: "theme", value: '"dark"', updatedAt: 1 },
			{ key: "sync.remindDays", value: "14", updatedAt: 1 },
		])
		.run()
	db.close()
	return root
}

async function digest(path: string) {
	return createHash("sha256")
		.update(await readFile(path))
		.digest("hex")
}

it("inspects an old-layout library without changing any source file", async () => {
	const root = await fixture()
	const path = join(root, "app.sqlite")
	const before = await digest(path)
	const result = inspectBackupLayout({ root, builtinDir: builtin })
	expect(result.migrated).toBe(false)
	expect(result.addBuiltin).toBe(true)
	expect(await digest(path)).toBe(before)
	expect(await readdir(join(root, "local"))).toEqual([".session-key"])
})

it("separates host state, keeps media in place, preserves old backups, and stamps the format", async () => {
	const root = await fixture()
	const resource = join(root, "versions/1/resources/resource/data/media.bin")
	const originalResource = await stat(resource)
	applyBackupLayout({ root, builtinDir: builtin })
	const live = openDb(join(root, "app.sqlite")),
		host = openDb(join(root, "local/host.sqlite"))
	const original = openDb(
		join(root, "local/backup-layout-migration/original.sqlite"),
	)
	try {
		expect(getAuthRow(live.db)).toBeUndefined()
		expect(getAuthRow(host.db)).toEqual(getAuthRow(original.db))
		expect(
			host.db
				.select()
				.from(schema.systemPreferences)
				.all()
				.map((row) => row.key),
		).toEqual(["sync.remindDays"])
		expect(
			live.db
				.select()
				.from(schema.systemPreferences)
				.all()
				.map((row) => row.key),
		).toEqual(["theme"])
	} finally {
		live.close()
		host.close()
		original.close()
	}
	expect(await readFile(resource, "utf8")).toBe("unchanged-media")
	expect((await stat(resource)).ino).toBe(originalResource.ino)
	expect((await stat(resource)).mtimeMs).toBe(originalResource.mtimeMs)
	expect(
		await readFile(
			join(root, "local/backup-layout-migration/db-backups/old.sqlite"),
			"utf8",
		),
	).toBe("old-backup")
	expect(
		await readFile(
			join(root, "local/backup-layout-migration/snapshots/auto.sqlite"),
			"utf8",
		),
	).toBe("old-snapshot")
	expect(await readdir(join(root, "versions/1"))).not.toContain("snapshots")
	const copiedManifest = join(
		root,
		"versions/1/plugins/a1b2c3d4-e5f6-7890-abcd-ef1234567890/manifest.json",
	)
	expect(await digest(copiedManifest)).toBe(
		await digest(join(builtin, "manifest.json")),
	)
	expect(await readFile(join(root, "local/.session-key"), "utf8")).toBe(
		Buffer.alloc(32, 5).toString("base64"),
	)
})

it("is idempotent and re-running an in-place conversion is a no-op", async () => {
	const root = await fixture()
	applyBackupLayout({ root, builtinDir: builtin })
	const hostBefore = await digest(join(root, "local/host.sqlite"))
	const again = applyBackupLayout({ root, builtinDir: builtin })
	expect(again.migrated).toBe(true)
	expect(await digest(join(root, "local/host.sqlite"))).toBe(hostBefore)
})

it("boots the next version against an old-layout library without a manual step", async () => {
	const root = await fixture()
	built = await buildServer({ env: envFor(root) })
	const response = await built.app.inject({
		method: "POST",
		url: "/auth/login",
		payload: { password: "migration-password" },
	})
	expect(response.statusCode).toBe(200)
	// Boot established the marker.
	expect(await readFile(join(root, "local/storage-format.json"), "utf8")).toBe(
		JSON.stringify({ format: 1 }),
	)
	// A second boot is a no-op (no re-migration, marker unchanged).
	await built.close()
	built = await buildServer({ env: envFor(root) })
	expect(await readFile(join(root, "local/storage-format.json"), "utf8")).toBe(
		JSON.stringify({ format: 1 }),
	)
})

it("refuses an active service before creating migration files", async () => {
	const root = await fixture()
	const release = acquireStorageInstance(root)
	try {
		await expect(buildServer({ env: envFor(root) })).rejects.toMatchObject({
			message: expect.stringContaining("Another service already owns"),
		})
		expect(await readdir(join(root, "local"))).not.toContain(
			"backup-layout-migration",
		)
	} finally {
		release()
	}
})

it("refuses archived layouts and older schemas before writing", async () => {
	const root = await fixture()
	await mkdir(join(root, "versions/2"))
	expect(() => inspectBackupLayout({ root, builtinDir: builtin })).toThrow(
		"no frozen archives",
	)
	await rm(join(root, "versions/2"), { recursive: true })
	const db = openDb(join(root, "app.sqlite"))
	await db.db.run("DELETE FROM __drizzle_migrations")
	db.close()
	expect(() => inspectBackupLayout({ root, builtinDir: builtin })).toThrow(
		"schema is not current",
	)
	expect(await readdir(join(root, "local"))).toEqual([".session-key"])
})

it("resumes after host rows were removed but host publication was interrupted", async () => {
	const root = await fixture()
	applyBackupLayout({ root, builtinDir: builtin })
	const work = join(root, "local/backup-layout-migration")
	await rm(join(root, "local/host.sqlite"))
	await writeFile(
		join(work, "state.json"),
		JSON.stringify({ format: 1, phase: "prepared" }),
	)
	applyBackupLayout({ root, builtinDir: builtin })
	const host = openDb(join(root, "local/host.sqlite"))
	try {
		expect(getAuthRow(host.db)?.hash).toBeTruthy()
	} finally {
		host.close()
	}
})

it("rejects broken plugin trees without changing the library", async () => {
	const root = await fixture()
	const db = openDb(join(root, "app.sqlite"))
	db.db
		.insert(schema.contentPlugins)
		.values({
			id: "missing-plugin",
			manifest: "{}",
			priority: 1,
			createdAt: 1,
			updatedAt: 1,
		})
		.run()
	db.close()
	const before = await digest(join(root, "app.sqlite"))
	expect(() => applyBackupLayout({ root, builtinDir: builtin })).toThrow()
	expect(await digest(join(root, "app.sqlite"))).toBe(before)
	expect(await readdir(join(root, "local"))).toEqual([".session-key"])
})

it("refuses shared plugin files before preparing a migration", async () => {
	const root = await fixture()
	const source = join(root, "shared.bin")
	await writeFile(source, "shared-plugin-content")
	await link(source, join(root, "versions/1/plugins/shared.bin"))
	expect(() => inspectBackupLayout({ root, builtinDir: builtin })).toThrow(
		"independent file",
	)
	expect(await readdir(join(root, "local"))).toEqual([".session-key"])
})

it("stamps the format on an already-converted library without re-running", async () => {
	const root = await fixture()
	applyBackupLayout({ root, builtinDir: builtin })
	// Converted by the migration, but the framework's marker is not yet present.
	expect(isOldLayoutLibrary(root)).toBe(false)
	expect(readStorageFormat(root)).toBe(0)
	// Boot sees an already-converted library; it records the current format
	// without re-running structural work.
	built = await buildServer({ env: envFor(root) })
	expect(readStorageFormat(root)).toBe(1)
	const again = applyBackupLayout({ root, builtinDir: builtin })
	expect(again.migrated).toBe(true)
})

it("inspects a v0.1.15 legacy library without mutating it", async () => {
	const root = await legacyFixture()
	const path = join(root, "app.sqlite")
	const before = await digest(path)
	const result = inspectBackupLayout({ root, builtinDir: builtin })
	expect(result.migrated).toBe(false)
	expect(result.schemaUpgradeRequired).toBe(true)
	expect(await digest(path)).toBe(before)
	expect(await readdir(join(root, "local"))).toEqual([".session-key"])
})

it("upgrades a v0.1.15 schema, separates host state, and starts the next server", async () => {
	const root = await legacyFixture()
	const resource = join(root, "versions/1/resources/resource/data/media.bin")
	const originalResource = await stat(resource)
	applyBackupLayout({ root, builtinDir: builtin })
	const live = openDb(join(root, "app.sqlite")),
		host = openDb(join(root, "local/host.sqlite")),
		original = openDb(
			join(root, "local/backup-layout-migration/original.sqlite"),
		)
	try {
		expect(getAuthRow(live.db)).toBeUndefined()
		expect(getAuthRow(host.db)).toEqual(getAuthRow(original.db))
		expect(
			host.db
				.select()
				.from(schema.systemPreferences)
				.all()
				.map((row) => row.key),
		).toEqual(["sync.remindDays"])
		expect(
			live.db
				.select()
				.from(schema.systemPreferences)
				.all()
				.map((row) => row.key),
		).toEqual(["theme"])
	} finally {
		live.close()
		host.close()
		original.close()
	}
	const db = new Database(join(root, "app.sqlite"))
	try {
		const tables = db
			.prepare("SELECT name FROM sqlite_master WHERE type = 'table'")
			.all()
			.map((row) => (row as { name: string }).name)
		expect(tables).not.toContain("sync_records")
		expect(tables).not.toContain("sync_devices")
		const migrations = db
			.prepare("SELECT COUNT(*) AS n FROM __drizzle_migrations")
			.get() as { n: number }
		expect(migrations.n).toBe(7)
	} finally {
		db.close()
	}
	expect(await readFile(resource, "utf8")).toBe("unchanged-media")
	expect((await stat(resource)).ino).toBe(originalResource.ino)
	expect(await readdir(join(root, "versions/1"))).not.toContain("snapshots")
	built = await buildServer({ env: envFor(root) })
	const response = await built.app.inject({
		method: "POST",
		url: "/auth/login",
		payload: { password: "migration-password" },
	})
	expect(response.statusCode).toBe(200)
}, 30000)

it("inspects a minimal v0.1.15 library (no local folder) without mutating it", async () => {
	const root = await legacyFixture({ local: false, plugins: false })
	const path = join(root, "app.sqlite")
	const before = await digest(path)
	const result = inspectBackupLayout({ root, builtinDir: builtin })
	expect(result.migrated).toBe(false)
	expect(result.schemaUpgradeRequired).toBe(true)
	expect(await digest(path)).toBe(before)
	expect(await readdir(root)).not.toContain("local")
	expect(await readdir(join(root, "versions/1"))).not.toContain("plugins")
})

it("migrates a minimal v0.1.15 library that has no local folder", async () => {
	const root = await legacyFixture({ local: false, plugins: false })
	const resource = join(root, "versions/1/resources/resource/data/media.bin")
	const originalResource = await stat(resource)
	applyBackupLayout({ root, builtinDir: builtin })
	const live = openDb(join(root, "app.sqlite")),
		host = openDb(join(root, "local/host.sqlite"))
	try {
		expect(getAuthRow(live.db)).toBeUndefined()
		expect(getAuthRow(host.db)?.hash).toBeTruthy()
		expect(
			host.db
				.select()
				.from(schema.systemPreferences)
				.all()
				.map((row) => row.key),
		).toEqual(["sync.remindDays"])
		expect(
			live.db
				.select()
				.from(schema.systemPreferences)
				.all()
				.map((row) => row.key),
		).toEqual(["theme"])
	} finally {
		live.close()
		host.close()
	}
	await expect(stat(resource)).resolves.toBeTruthy()
	expect((await stat(resource)).ino).toBe(originalResource.ino)
	expect(await readdir(join(root, "versions/1"))).toContain("plugins")
	expect(await readdir(join(root, "local"))).toContain("host.sqlite")
	built = await buildServer({ env: envFor(root) })
	const response = await built.app.inject({
		method: "POST",
		url: "/auth/login",
		payload: { password: "migration-password" },
	})
	expect(response.statusCode).toBe(200)
}, 30000)

it("does not overwrite an already-installed builtin plugin", async () => {
	const root = await fixture()
	const target = join(
		root,
		"versions/1/plugins/a1b2c3d4-e5f6-7890-abcd-ef1234567890",
	)
	await mkdir(target, { recursive: true })
	await copyFile(join(builtin, "manifest.json"), join(target, "manifest.json"))
	await copyFile(join(builtin, "main.js"), join(target, "main.js"))
	const manifest = JSON.parse(
		await readFile(join(target, "manifest.json"), "utf8"),
	) as { version: string }
	manifest.version = "9.9.9"
	await writeFile(join(target, "manifest.json"), JSON.stringify(manifest))

	const inspection = inspectBackupLayout({ root, builtinDir: builtin })
	expect(inspection.addBuiltin).toBe(false)
	applyBackupLayout({ root, builtinDir: builtin })
	// The pre-installed copy is untouched (the migration did not re-copy it).
	const after = JSON.parse(
		await readFile(join(target, "manifest.json"), "utf8"),
	) as { version: string }
	expect(after.version).toBe("9.9.9")
})

it("refuses when both the original and a saved legacy folder exist", async () => {
	const root = await fixture()
	const work = join(root, "local", "backup-layout-migration")
	// A prior run saved a legacy folder mid-migration (valid phase state), so
	// `readState` passes and the "both exist" check is reached.
	await mkdir(work, { recursive: true })
	await writeFile(
		join(work, "state.json"),
		JSON.stringify({ format: 1, phase: "preparing" }),
	)
	await mkdir(join(work, "db-backups"), { recursive: true })
	expect(() => inspectBackupLayout({ root, builtinDir: builtin })).toThrow(
		"Both original and saved db-backups exist",
	)
})

it("refuses a database created by a newer application version", async () => {
	const root = await fixture()
	const raw = new Database(join(root, "app.sqlite"))
	try {
		const row = raw
			.prepare("SELECT MAX(created_at) AS m FROM __drizzle_migrations")
			.get() as { m: number }
		raw
			.prepare(
				"INSERT INTO __drizzle_migrations (id, hash, created_at) VALUES (?, ?, ?)",
			)
			.run(999_999, "future-hash", (row.m ?? 0) + 1)
	} finally {
		raw.close()
	}
	expect(() => inspectBackupLayout({ root, builtinDir: builtin })).toThrow(
		"requires a newer application version",
	)
})
