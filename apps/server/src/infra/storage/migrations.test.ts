import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadEnv } from "src/config/env.ts"
import {
	openDb,
	resolveMigrationsFolder,
	schema,
} from "src/infra/db/connection.ts"
import {
	isOldLayoutLibrary,
	type MigrationContext,
	runStorageMigrations,
	type StorageMigration,
} from "src/infra/storage/migrations.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import {
	CURRENT_FORMAT,
	readStorageFormat,
	writeStorageFormat,
} from "src/infra/storage/storage-format.ts"
import { afterEach, describe, expect, it } from "vitest"

const roots: string[] = []
afterEach(() => {
	for (const root of roots.splice(0))
		rmSync(root, { recursive: true, force: true })
})

function emptyRoot(): string {
	const root = mkdtempSync(join(tmpdir(), "stor-migrate-"))
	roots.push(root)
	return root
}

/** An old-layout root still stores its host credentials in the live DB. */
function oldLayoutRoot(): string {
	const root = emptyRoot()
	mkdirSync(join(root, "versions", "1"), { recursive: true })
	const handles = openDb(join(root, "app.sqlite"))
	handles.runMigrations()
	handles.db
		.insert(schema.auth)
		.values({ passwordHash: "legacy-hash", updatedAt: 1 })
		.run()
	handles.close()
	return root
}

function contextFor(root: string): Omit<MigrationContext, "root"> {
	const env = loadEnv({
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
		STORAGE_ROOT: root,
		DISABLE_DEV_PLUGINS: "true",
	})
	return {
		builtinDir: env.BUILTIN_PATH,
		env,
		storagePaths: createStoragePaths({ root }),
		migrationsFolder: resolveMigrationsFolder(),
		openDb: (url) => openDb(url),
	}
}

function mkMigration(
	id: string,
	targetFormat: number,
	onRun: () => void,
	applies: StorageMigration["applies"] = (_ctx, cur) => cur < targetFormat,
): StorageMigration {
	return { id, targetFormat, applies, run: () => onRun() }
}

describe("runStorageMigrations", () => {
	it("runs applicable migrations in target-format order", () => {
		const root = oldLayoutRoot()
		const order: string[] = []
		const registry = [
			mkMigration(
				"a",
				1,
				() => order.push("a"),
				(ctx, cur) => cur < 1 && isOldLayoutLibrary(ctx.root),
			),
			mkMigration("b", 2, () => order.push("b")),
		]
		const result = runStorageMigrations(root, contextFor(root), registry)
		expect(order).toEqual(["a", "b"])
		expect(result.format).toBe(2)
		expect(readStorageFormat(root)).toBe(2)
	})

	it("skips migrations already at or below the current format", () => {
		const root = oldLayoutRoot()
		writeStorageFormat(root, 1)
		const ran: string[] = []
		const registry = [
			mkMigration("a", 1, () => ran.push("a")),
			mkMigration("b", 2, () => ran.push("b")),
		]
		const result = runStorageMigrations(root, contextFor(root), registry)
		expect(ran).toEqual(["b"])
		expect(result.format).toBe(2)
		expect(readStorageFormat(root)).toBe(2)
	})

	it("does not stamp when a migration rejects the library as unsupported", () => {
		const root = oldLayoutRoot()
		const registry = [
			{
				id: "x",
				targetFormat: 1,
				applies: () => true,
				run: () => {
					throw new Error("unsupported layout")
				},
			},
		]
		expect(() =>
			runStorageMigrations(root, contextFor(root), registry),
		).toThrow("unsupported layout")
		expect(readStorageFormat(root)).toBe(0)
	})

	it("stamps the current format on an unmarked, non-old root", () => {
		const root = emptyRoot()
		const result = runStorageMigrations(root, contextFor(root), [])
		expect(result.ran).toEqual([])
		expect(result.format).toBe(CURRENT_FORMAT)
		expect(readStorageFormat(root)).toBe(CURRENT_FORMAT)
	})

	it("is a no-op when the marker is already current", () => {
		const root = emptyRoot()
		writeStorageFormat(root, CURRENT_FORMAT)
		const result = runStorageMigrations(root, contextFor(root), [])
		expect(result.changed).toBe(false)
		expect(readStorageFormat(root)).toBe(CURRENT_FORMAT)
	})

	it("promotes the legacy local marker and keeps it after local is deleted", () => {
		const root = emptyRoot()
		mkdirSync(join(root, "local"))
		writeFileSync(
			join(root, "local", "storage-format.json"),
			JSON.stringify({ format: 1 }),
		)
		expect(readStorageFormat(root)).toBe(1)
		runStorageMigrations(root, contextFor(root))
		expect(
			JSON.parse(readFileSync(join(root, "storage-format.json"), "utf8")),
		).toEqual({ format: 1 })
		rmSync(join(root, "local"), { recursive: true })
		expect(readStorageFormat(root)).toBe(1)
	})

	it("prefers the durable marker over a stale local marker", () => {
		const root = emptyRoot()
		writeStorageFormat(root, 2)
		mkdirSync(join(root, "local"), { recursive: true })
		writeFileSync(
			join(root, "local", "storage-format.json"),
			JSON.stringify({ format: 1 }),
		)
		expect(readStorageFormat(root)).toBe(2)
	})

	it("repairs a corrupt root marker using a valid legacy local marker", () => {
		const root = emptyRoot()
		mkdirSync(join(root, "local"))
		writeFileSync(
			join(root, "local", "storage-format.json"),
			JSON.stringify({ format: 1 }),
		)
		writeFileSync(join(root, "storage-format.json"), "not json")
		runStorageMigrations(root, contextFor(root))
		expect(
			JSON.parse(readFileSync(join(root, "storage-format.json"), "utf8")),
		).toEqual({ format: 1 })
	})

	it("re-establishes a corrupt storage-format marker on a current root", () => {
		const root = emptyRoot()
		mkdirSync(join(root, "local"), { recursive: true })
		writeFileSync(join(root, "local", "storage-format.json"), "not json")
		const result = runStorageMigrations(root, contextFor(root), [])
		// No migration ran, but the unreadable marker is treated as unmarked and
		// the library is anchored at the current format.
		expect(result.changed).toBe(false)
		expect(result.format).toBe(CURRENT_FORMAT)
		expect(readStorageFormat(root)).toBe(CURRENT_FORMAT)
	})
})

describe("isOldLayoutLibrary", () => {
	it("is true when host credentials remain in app.sqlite", () => {
		expect(isOldLayoutLibrary(oldLayoutRoot())).toBe(true)
	})

	it("is false when host.sqlite exists", () => {
		const root = oldLayoutRoot()
		mkdirSync(join(root, "local"), { recursive: true })
		writeFileSync(join(root, "local", "host.sqlite"), "")
		expect(isOldLayoutLibrary(root)).toBe(false)
	})

	it("is false when app.sqlite is absent", () => {
		expect(isOldLayoutLibrary(emptyRoot())).toBe(false)
	})

	it("recognizes an unmarked current DB without local as rebuildable", () => {
		const root = emptyRoot()
		const handles = openDb(join(root, "app.sqlite"))
		handles.runMigrations()
		handles.close()
		expect(isOldLayoutLibrary(root)).toBe(false)
		runStorageMigrations(root, contextFor(root))
		expect(readStorageFormat(root)).toBe(CURRENT_FORMAT)
	})

	it.each(["db-backups", "snapshots"])(
		"recognizes legacy %s even without credentials",
		(folder) => {
			const root = emptyRoot()
			const handles = openDb(join(root, "app.sqlite"))
			handles.runMigrations()
			handles.close()
			mkdirSync(join(root, "versions", "1", folder), { recursive: true })
			expect(isOldLayoutLibrary(root)).toBe(true)
		},
	)

	it("recognizes host-only preferences as legacy data", () => {
		const root = emptyRoot()
		const handles = openDb(join(root, "app.sqlite"))
		handles.runMigrations()
		handles.db
			.insert(schema.systemPreferences)
			.values({ key: "sync.remindDays", value: "14", updatedAt: 1 })
			.run()
		handles.close()
		expect(isOldLayoutLibrary(root)).toBe(true)
	})

	it("recognizes an interrupted migration after host rows have been removed", () => {
		const root = emptyRoot()
		const handles = openDb(join(root, "app.sqlite"))
		handles.runMigrations()
		handles.close()
		const work = join(root, "local", "backup-layout-migration")
		mkdirSync(work, { recursive: true })
		writeFileSync(
			join(work, "state.json"),
			JSON.stringify({ format: 1, phase: "prepared" }),
		)
		expect(isOldLayoutLibrary(root)).toBe(true)
	})

	it("propagates database read failures without stamping the library", () => {
		const root = emptyRoot()
		writeFileSync(join(root, "app.sqlite"), "corrupt sqlite")
		expect(() => runStorageMigrations(root, contextFor(root))).toThrow()
		expect(existsSync(join(root, "storage-format.json"))).toBe(false)
	})
})
