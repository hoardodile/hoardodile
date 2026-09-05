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
import { DomainError } from "@hoardodile/shared"
import { sql } from "drizzle-orm"
import { openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createStoragePaths } from "./paths.ts"
import { stageViewCloneDb } from "./version-view.ts"

describe("stageViewCloneDb", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "ver-clone-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("clones archive DB and passes integrity check", () => {
		mkdirSync(join(root, "versions", "1"), { recursive: true })
		const src = join(root, "versions", "1", "app.sqlite")
		const dbh = openDb(src)
		dbh.runMigrations()
		dbh.close()

		const clonePath = stageViewCloneDb(createStoragePaths({ root }), 1)
		expect(clonePath).toContain("view-1.sqlite")
		expect(existsSync(clonePath)).toBe(true)

		const clone = openDb(clonePath, { readonly: true })
		expect(clone.integrityCheck()).toBe(true)
		clone.close()
	})

	test("throws when source DB is missing", () => {
		try {
			stageViewCloneDb(createStoragePaths({ root }), 1)
			expect.unreachable("should have thrown")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("version.db_missing")
		}
	})

	test("rejects an older schema without converting the archived database", () => {
		mkdirSync(join(root, "versions", "1"), { recursive: true })
		const source = join(root, "versions", "1", "app.sqlite")
		const handles = openDb(source)
		handles.runMigrations()
		handles.db.run(sql`DELETE FROM __drizzle_migrations`)
		handles.close()
		const before = readFileSync(source)
		expect(() => stageViewCloneDb(createStoragePaths({ root }), 1)).toThrow(
			"unsupported database schema",
		)
		expect(readFileSync(source)).toEqual(before)
	})

	test("throws when clone fails integrity check", () => {
		mkdirSync(join(root, "versions", "1"), { recursive: true })
		const src = join(root, "versions", "1", "app.sqlite")
		// Write garbage instead of a valid SQLite file
		writeFileSync(src, "this is not a sqlite database")

		try {
			stageViewCloneDb(createStoragePaths({ root }), 1)
			expect.unreachable("should have thrown")
		} catch (err) {
			expect(err).toBeInstanceOf(DomainError)
			expect((err as DomainError).kind).toBe("version.clone_corrupt")
		}
	})

	test("cleans up stale WAL and SHM before cloning", () => {
		mkdirSync(join(root, "versions", "1"), { recursive: true })
		const src = join(root, "versions", "1", "app.sqlite")
		const dbh = openDb(src)
		dbh.runMigrations()
		dbh.close()

		// Pre-create stale sidecar files in the cache tmp dir to simulate a
		// previous failed clone.
		mkdirSync(join(root, "local", "cache", "tmp"), { recursive: true })
		const staleClone = join(root, "local", "cache", "tmp", "view-1.sqlite")
		writeFileSync(staleClone, "stale")
		writeFileSync(`${staleClone}-wal`, "stale-wal")
		writeFileSync(`${staleClone}-shm`, "stale-shm")

		const clonePath = stageViewCloneDb(createStoragePaths({ root }), 1)
		expect(existsSync(clonePath)).toBe(true)
		// The stale sidecars must be gone; the fresh clone may have new WAL/SHM
		// created by SQLite when opening in WAL mode, so we only assert the
		// stale contents were removed.
		expect(readFileSync(clonePath, "utf8")).not.toBe("stale")
		expect(
			existsSync(`${clonePath}-wal`)
				? readFileSync(`${clonePath}-wal`, "utf8")
				: "",
		).not.toBe("stale-wal")
		expect(
			existsSync(`${clonePath}-shm`)
				? readFileSync(`${clonePath}-shm`, "utf8")
				: "",
		).not.toBe("stale-shm")
	})
})
