/**
 * Shared runtime primitives used by the standalone server entry, the
 * first-run web setup flow and the reset CLI. Everything that touches the
 * auth row goes through the auth repo so the write paths cannot drift.
 */

import type { Env } from "src/config/env.ts"
import { resolveAvailablePort } from "src/config/port.ts"
import { hashPassword } from "src/domain/auth/password.ts"
import { deleteAuthRow, getAuthRow, setAuthRow } from "src/domain/auth/repo.ts"
import { assessPasswordStrength } from "src/domain/auth/strength.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { resolveStorageContext } from "src/infra/storage/bootstrap.ts"
import { type BuiltServer, buildServer } from "src/server.ts"

/**
 * Open the runtime DB at `env`'s storage location with migrations applied,
 * run `fn`, and close the short-lived connection. Safe to call BEFORE the
 * long-running server starts (and from other short-lived processes such as
 * the reset CLI); callers that already hold the live handle should use the
 * auth repo functions directly instead.
 */
function withRuntimeDb<T>(
	env: Env,
	fn: (db: ReturnType<typeof openDb>) => T,
): T {
	const ctx = resolveStorageContext(env)
	const dbHandles = openDb(ctx.dbFilePath)
	try {
		if (!ctx.readOnly) dbHandles.runMigrations()
		return fn(dbHandles)
	} finally {
		dbHandles.close()
	}
}

/**
 * Hash `password` with argon2id and upsert it as the single-user auth row.
 * The single entry point for the first-run web setup, the password-change
 * route and the CLI reset seeds.
 *
 * @throws when `password` is empty.
 * @throws when the storage is being viewed read-only (past version).
 */
export async function writeAuthPassword(
	env: Env,
	password: string,
): Promise<void> {
	const ctx = resolveStorageContext(env)
	if (ctx.readOnly) {
		throw new Error(
			"app: cannot write password while viewing a past version (read-only)",
		)
	}
	const hash = await hashPassword(password)
	withRuntimeDb(env, (dbHandles) => {
		setAuthRow(dbHandles.db, {
			hash,
			updatedAt: Date.now(),
			weakPassword: assessPasswordStrength(password) === "weak",
		})
	})
}

/**
 * Remove the auth row, returning the server to the unconfigured state so
 * the web setup flow can claim it again. Used by the `app-server-reset`
 * CLI as the recovery path for a forgotten password.
 *
 * @throws when the storage is being viewed read-only (past version).
 */
export function clearAuthPassword(env: Env): void {
	const ctx = resolveStorageContext(env)
	if (ctx.readOnly) {
		throw new Error(
			"app: cannot reset password while viewing a past version (read-only)",
		)
	}
	withRuntimeDb(env, (dbHandles) => {
		deleteAuthRow(dbHandles.db)
	})
}

/**
 * Whether the runtime DB currently has an admin password configured. Used
 * by the server entry to warn the operator when the instance is still
 * unclaimed (anyone who can reach it can claim it via the web setup).
 */
export function isAuthConfigured(env: Env): boolean {
	return withRuntimeDb(
		env,
		(dbHandles) => getAuthRow(dbHandles.db) !== undefined,
	)
}

export type LaunchedServer = {
	readonly built: BuiltServer
	readonly host: string
	readonly port: number
}

export type LaunchHttpServerOptions = {
	readonly env: Env
	readonly webRoot?: string
	readonly onContextReloaded?: () => void
}

/**
 * Build a Fastify instance via {@link buildServer}, resolve a free port
 * (preferring `env.PORT`, falling back to an OS-picked one) and start
 * listening. Returns the running instance plus the resolved bind info so
 * callers can surface it.
 */
export async function launchHttpServer(
	opts: LaunchHttpServerOptions,
): Promise<LaunchedServer> {
	const ctx = resolveStorageContext(opts.env)
	const built = await buildServer({
		env: opts.env,
		webRoot: opts.webRoot,
		onContextReloaded: opts.onContextReloaded,
		storagePaths: ctx.paths,
		databaseUrl: ctx.dbFilePath,
		readOnly: ctx.readOnly,
	})
	const port = await resolveAvailablePort(opts.env.PORT, opts.env.HOST)
	await built.app.listen({ host: opts.env.HOST, port })

	// ── TCP keepalive ─────────────────────────────────────────────────────
	// LAN clients reach the server over WiFi or Ethernet through a router
	// whose NAT/ARP table expires idle entries after ~1-5 minutes. Without
	// OS-level keepalive probes the router silently drops the mapping and
	// the next request stalls for 5-30 s while the client re-establishes
	// connectivity. Enabling TCP keepalive at 60 s keeps those entries
	// fresh. The HTTP keepAliveTimeout in server.ts is aligned to the same
	// 2-minute window so application-level connection reuse matches.
	const server = built.app.server
	if (server) {
		server.on("connection", (socket) => {
			socket.setKeepAlive(true, 60_000)
		})
	}

	return { built, host: opts.env.HOST, port }
}

export { schema }
