import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureBootstrapVersion, publishVersion } from "@hoardodile/host/hoard"
import { loadEnv } from "src/config/env.ts"
import { openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { resolveStorageContext } from "./bootstrap.ts"

describe("resolveStorageContext", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "bootstrap-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test(":memory: mode returns non-versioned context", () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			DATABASE_URL: ":memory:",
			STORAGE_ROOT: root,
		})
		const ctx = resolveStorageContext(env)
		expect(ctx.readOnly).toBe(false)
		expect(ctx.latestVersion).toBe(1)
		expect(ctx.activeVersion).toBe(1)
		expect(ctx.dbFilePath).toBe(":memory:")
	})

	test("active === current returns readOnly false with runtime DB", () => {
		ensureBootstrapVersion(root)
		const liveDbPath = join(root, "app.sqlite")
		const dbh = openDb(liveDbPath)
		dbh.runMigrations()
		dbh.close()

		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		})
		const ctx = resolveStorageContext(env)
		expect(ctx.readOnly).toBe(false)
		expect(ctx.latestVersion).toBe(1)
		expect(ctx.activeVersion).toBe(1)
		expect(ctx.dbFilePath).toBe(liveDbPath)
		expect(ctx.paths.runtimeDb()).toBe(liveDbPath)
	})

	test("active < current returns readOnly true with cloned snapshot", async () => {
		ensureBootstrapVersion(root)
		const liveDbPath = join(root, "app.sqlite")
		const dbh = openDb(liveDbPath)
		dbh.runMigrations()
		dbh.close()

		// Publish version 2 so version 1 becomes an archive
		await publishVersion({
			root,
			snapshot: async (dest) => {
				const h = openDb(liveDbPath)
				h.vacuumInto(dest)
				h.close()
			},
		})

		// Switch active to version 1
		mkdirSync(join(root, "local"), { recursive: true })
		writeFileSync(
			join(root, "local", "version-state.json"),
			JSON.stringify({ active: 1 }),
		)

		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		})
		const ctx = resolveStorageContext(env)
		expect(ctx.readOnly).toBe(true)
		expect(ctx.latestVersion).toBe(2)
		expect(ctx.activeVersion).toBe(1)
		expect(ctx.dbFilePath).toContain("view-1.sqlite")
		expect(existsSync(ctx.dbFilePath)).toBe(true)

		// Clone must be readable and pass integrity check
		const clone = openDb(ctx.dbFilePath, { readonly: true })
		expect(clone.integrityCheck()).toBe(true)
		clone.close()
	})

	test("missing state file auto-fallbacks to current", () => {
		ensureBootstrapVersion(root)
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		})
		const ctx = resolveStorageContext(env)
		expect(ctx.readOnly).toBe(false)
		expect(ctx.activeVersion).toBe(1)
		expect(ctx.latestVersion).toBe(1)
	})

	test("corrupt state file auto-fallbacks to current", () => {
		ensureBootstrapVersion(root)
		mkdirSync(join(root, "local"), { recursive: true })
		writeFileSync(join(root, "local", "version-state.json"), "not json")

		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		})
		const ctx = resolveStorageContext(env)
		expect(ctx.readOnly).toBe(false)
		expect(ctx.activeVersion).toBe(1)
	})
})
