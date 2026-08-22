import { loadEnv } from "src/config/env.ts"
import { buildSystemPrefRepository } from "src/domain/prefs/repo.ts"
import { openDb } from "src/infra/db/connection.ts"
import { expect, test } from "vitest"
import {
	resolveSessionTtl,
	SESSION_TTL_MAX_SECONDS,
	SESSION_TTL_MIN_SECONDS,
	SESSION_TTL_PREF_KEY,
} from "./ttl.ts"

const env = loadEnv({})

test("resolveSessionTtl falls back to env when the pref is unset", () => {
	const h = openDb(":memory:")
	try {
		h.runMigrations()
		expect(resolveSessionTtl(h.db, env)).toBe(env.SESSION_TTL_SECONDS)
	} finally {
		h.close()
	}
})

test("resolveSessionTtl prefers the runtime pref value", () => {
	const h = openDb(":memory:")
	try {
		h.runMigrations()
		const repo = buildSystemPrefRepository(h.db)
		repo.upsert(SESSION_TTL_PREF_KEY, String(60 * 60), 1)
		expect(resolveSessionTtl(h.db, env)).toBe(60 * 60)
	} finally {
		h.close()
	}
})

test("resolveSessionTtl ignores malformed pref values", () => {
	const h = openDb(":memory:")
	try {
		h.runMigrations()
		const repo = buildSystemPrefRepository(h.db)
		for (const bad of ["", "abc", "-5", "1.5", "0"]) {
			repo.upsert(SESSION_TTL_PREF_KEY, bad, 1)
			expect(resolveSessionTtl(h.db, env)).toBe(env.SESSION_TTL_SECONDS)
		}
	} finally {
		h.close()
	}
})

test("resolveSessionTtl clamps out-of-range values", () => {
	const h = openDb(":memory:")
	try {
		h.runMigrations()
		const repo = buildSystemPrefRepository(h.db)
		repo.upsert(SESSION_TTL_PREF_KEY, String(10), 1)
		expect(resolveSessionTtl(h.db, env)).toBe(SESSION_TTL_MIN_SECONDS)
		repo.upsert(SESSION_TTL_PREF_KEY, String(SESSION_TTL_MAX_SECONDS * 10), 1)
		expect(resolveSessionTtl(h.db, env)).toBe(SESSION_TTL_MAX_SECONDS)
	} finally {
		h.close()
	}
})
