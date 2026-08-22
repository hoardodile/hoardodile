import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { loadEnv } from "src/config/env.ts"
import { verifyPassword } from "src/domain/auth/password.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import {
	clearAuthPassword,
	isAuthConfigured,
	writeAuthPassword,
} from "./runtime.ts"

describe("writeAuthPassword", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-runtime-pw-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("stores a verifiable argon2id hash on a fresh DB", async () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		} satisfies NodeJS.ProcessEnv)
		await writeAuthPassword(env, "hunter2")

		const dbh = openDb(env.DATABASE_URL)
		try {
			const row = dbh.db
				.select({ hash: schema.auth.passwordHash })
				.from(schema.auth)
				.where(eq(schema.auth.singleton, 1))
				.get()
			expect(row).toBeDefined()
			if (!row) throw new Error("unreachable")
			expect(await verifyPassword(row.hash, "hunter2")).toBe(true)
		} finally {
			dbh.close()
		}
	})

	test("upserts when called twice (second password wins)", async () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		} satisfies NodeJS.ProcessEnv)
		await writeAuthPassword(env, "first")
		await writeAuthPassword(env, "second")

		const dbh = openDb(env.DATABASE_URL)
		try {
			const row = dbh.db
				.select({ hash: schema.auth.passwordHash })
				.from(schema.auth)
				.where(eq(schema.auth.singleton, 1))
				.get()
			if (!row) throw new Error("unreachable")
			expect(await verifyPassword(row.hash, "first")).toBe(false)
			expect(await verifyPassword(row.hash, "second")).toBe(true)
		} finally {
			dbh.close()
		}
	})

	test("rejects empty password", async () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		} satisfies NodeJS.ProcessEnv)
		await expect(writeAuthPassword(env, "")).rejects.toThrow()
	})
})

describe("clearAuthPassword", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-runtime-clear-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("removes the auth row so the server is unconfigured again", async () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		} satisfies NodeJS.ProcessEnv)
		await writeAuthPassword(env, "hunter2")
		expect(isAuthConfigured(env)).toBe(true)

		clearAuthPassword(env)
		expect(isAuthConfigured(env)).toBe(false)

		const dbh = openDb(env.DATABASE_URL)
		try {
			expect(dbh.db.select().from(schema.auth).get()).toBeUndefined()
		} finally {
			dbh.close()
		}
	})

	test("is a no-op when already unconfigured", () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		} satisfies NodeJS.ProcessEnv)
		clearAuthPassword(env)
		expect(isAuthConfigured(env)).toBe(false)
	})
})

describe("isAuthConfigured", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-runtime-cfg-"))
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("reports false on a storage with no DB yet", () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		} satisfies NodeJS.ProcessEnv)
		expect(isAuthConfigured(env)).toBe(false)
	})

	test("reports false when the DB exists but has no auth row", () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		} satisfies NodeJS.ProcessEnv)
		// Materialise the DB without writing a password row.
		const dbh = openDb(env.DATABASE_URL)
		dbh.runMigrations()
		dbh.close()

		expect(isAuthConfigured(env)).toBe(false)
	})

	test("reports true once writeAuthPassword has run", async () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		} satisfies NodeJS.ProcessEnv)
		await writeAuthPassword(env, "hunter2")
		expect(isAuthConfigured(env)).toBe(true)
	})
})
