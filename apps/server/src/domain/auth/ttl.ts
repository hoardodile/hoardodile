import type { Env } from "src/config/env.ts"
import { buildSystemPrefRepository } from "src/domain/prefs/repo.ts"
import type { SqliteDb } from "src/infra/db/connection.ts"

/** System-preference key holding the runtime session idle timeout (seconds). */
export const SESSION_TTL_PREF_KEY = "auth.sessionIdleTimeoutSeconds"

/** Guard rails for the runtime-configured TTL (60 s .. 365 d). */
export const SESSION_TTL_MIN_SECONDS = 60
export const SESSION_TTL_MAX_SECONDS = 365 * 24 * 60 * 60

/**
 * Resolve the session idle timeout for a request. Prefers the
 * runtime-configurable `auth.sessionIdleTimeoutSeconds` system preference
 * (set from the web Settings page); falls back to `env.SESSION_TTL_SECONDS`
 * when the preference is unset or malformed, and clamps stored values to
 * the guard rails.
 */
export function resolveSessionTtl(db: SqliteDb, env: Env): number {
	const row = buildSystemPrefRepository(db).get(SESSION_TTL_PREF_KEY)
	if (row === undefined) return env.SESSION_TTL_SECONDS
	const seconds = Number(row.value)
	if (!Number.isInteger(seconds) || seconds <= 0) {
		return env.SESSION_TTL_SECONDS
	}
	return Math.min(
		Math.max(seconds, SESSION_TTL_MIN_SECONDS),
		SESSION_TTL_MAX_SECONDS,
	)
}
