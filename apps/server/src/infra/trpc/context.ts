import type {} from "@fastify/cookie"
import type { FastifyReply, FastifyRequest } from "fastify"
import type { Env } from "src/config/env.ts"
import type { SessionStore } from "src/domain/auth/session.ts"
import { resolveSessionTtl } from "src/domain/auth/ttl.ts"
import type { SqliteDb } from "src/infra/db/connection.ts"

export type AppContext = {
	readonly env: Env
	readonly req: FastifyRequest
	readonly res: FastifyReply
	readonly sessionId: string | undefined
	readonly authenticated: boolean
}

export type BuildContextDeps = {
	readonly env: Env
	readonly db: SqliteDb
	readonly sessions: SessionStore
}

export type CreateContextArgs = {
	req: FastifyRequest
	res: FastifyReply
}

/**
 * Build the tRPC `createContext` function. Each call resolves the active
 * session (if any) from the request cookie and slides its expiry forward
 * per the rolling-TTL policy, then exposes it on the {@link AppContext} so
 * procedures can gate behaviour on `authenticated`.
 */
export function makeCreateContext(
	deps: BuildContextDeps,
): (args: CreateContextArgs) => Promise<AppContext> {
	return async function createContext({
		req,
		res,
	}: CreateContextArgs): Promise<AppContext> {
		const cookie = req.cookies[deps.env.SESSION_COOKIE_NAME]
		const touched = await deps.sessions.touch(
			cookie,
			resolveSessionTtl(
				req.server?.libraryMaintenance ? req.server.hostDb : deps.db,
				deps.env,
			),
		)
		return {
			env: deps.env,
			req,
			res,
			sessionId: touched?.session.id,
			authenticated: touched !== undefined,
		}
	}
}
