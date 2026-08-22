import rateLimit from "@fastify/rate-limit"
import {
	changePasswordRequest,
	loginRequest,
	setupRequest,
} from "@hoardodile/schemas"
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify"
import type { Env } from "src/config/env.ts"
import type { SqliteDb } from "src/infra/db/connection.ts"
import { readSeedManifestFromRoot } from "src/seed/manifest.ts"
import {
	clearSessionCookie,
	cookieOptions,
	writeSessionCookie,
} from "./cookie.ts"
import { hashPassword, verifyPassword } from "./password.ts"
import { getAuthRow, setAuthRow } from "./repo.ts"
import type { SessionStore } from "./session.ts"
import { resolveSessionTtl } from "./ttl.ts"

/**
 * Decide whether the incoming request is considered HTTPS. Honors the
 * `X-Forwarded-Proto` header set by a TLS-terminating reverse proxy and
 * falls back to the direct TLS indicator.
 */
function isHttpsRequest(req: FastifyRequest): boolean {
	const forwarded = req.headers["x-forwarded-proto"]
	if (typeof forwarded === "string") {
		return forwarded.toLowerCase() === "https"
	}
	return (
		(req.raw.socket as { encrypted?: boolean | undefined }).encrypted === true
	)
}

function httpsRequiredReply(reply: FastifyReply): FastifyReply {
	return reply
		.code(426)
		.type("application/json")
		.send({ error: "HTTPS required" })
}

export type AuthDeps = {
	readonly env: Env
	readonly db: SqliteDb
	readonly sessions: SessionStore
}

/**
 * Per-IP brute-force budget for the password-facing endpoints (`/auth/login`,
 * `/auth/setup`, `/auth/password`). 30 attempts per minute is generous for a
 * legitimate human (typo + retry) and very tight for an online
 * password-guessing attacker, even one with parallel IPs on the local
 * network.
 */
const PASSWORD_RATE_MAX = 30
const PASSWORD_RATE_WINDOW_MS = 60_000

/**
 * Register the `/auth/*` routes on the given Fastify instance. Supports the
 * single-user password flow: status probe, first-run setup (claimed only
 * while unconfigured), login (issues an HttpOnly SameSite=Strict cookie),
 * password change (session + current-password proof), and logout (clears
 * the cookie).
 *
 * Every successful `POST /auth/login` rotates the session id (a fresh
 * sealed cookie payload) so any pre-login token captured by fixation
 * attempts is useless afterwards.
 *
 * All password-handling endpoints are protected by `@fastify/rate-limit`
 * with a per-IP budget so a local-network attacker cannot trial passwords
 * at line-rate.
 */
export async function registerAuthRoutes(
	app: FastifyInstance,
	deps: AuthDeps,
): Promise<void> {
	const { env, db, sessions } = deps

	await app.register(rateLimit, { global: false })

	const passwordRateLimit = {
		max: PASSWORD_RATE_MAX,
		timeWindow: PASSWORD_RATE_WINDOW_MS,
	} as const

	// Every `/auth/*` endpoint requires TLS while FORCE_HTTPS is set —
	// passwords and session cookies must never travel in the clear.
	// Must be `async`: Fastify only advances past a hook when it returns a
	// promise (or calls `done`); a plain function returning `undefined`
	// would stall every request.
	app.addHook("preHandler", async (req, reply) => {
		if (env.FORCE_HTTPS && !isHttpsRequest(req)) {
			return httpsRequiredReply(reply)
		}
	})

	app.get("/auth/status", async (req, reply) => {
		const configured = getAuthRow(db) !== undefined
		if (!configured) {
			return { authenticated: false, configured: false }
		}
		const cookie = req.cookies[env.SESSION_COOKIE_NAME]
		const sessionTtl = resolveSessionTtl(db, env)
		const refreshed = await sessions.touch(cookie, sessionTtl)
		if (refreshed !== undefined && refreshed.sealed !== undefined) {
			writeSessionCookie(reply, refreshed.sealed, env, sessionTtl)
		}
		if (readSeedManifestFromRoot(env.STORAGE_ROOT) !== undefined) {
			return {
				authenticated: refreshed !== undefined,
				configured: true,
				demoPassword: true,
			}
		}
		return {
			authenticated: refreshed !== undefined,
			configured: true,
		}
	})

	app.post(
		"/auth/setup",
		{
			config: { rateLimit: passwordRateLimit },
		},
		async (req, reply) => {
			const parsed = setupRequest.safeParse(req.body)
			if (!parsed.success) {
				reply.code(400)
				return { error: "invalid body" }
			}
			if (getAuthRow(db) !== undefined) {
				reply.code(409)
				return { error: "already configured" }
			}
			setAuthRow(db, {
				hash: await hashPassword(parsed.data.password),
				updatedAt: Date.now(),
			})
			return { ok: true as const }
		},
	)

	app.post(
		"/auth/login",
		{
			config: { rateLimit: passwordRateLimit },
		},
		async (req, reply) => {
			const parsed = loginRequest.safeParse(req.body)
			if (!parsed.success) {
				reply.code(400)
				return { error: "invalid body" }
			}
			const auth = getAuthRow(db)
			if (auth === undefined) {
				reply.code(401)
				return { error: "not configured" }
			}
			const ok = await verifyPassword(auth.hash, parsed.data.password, req.log)
			if (!ok) {
				reply.code(401)
				return { error: "unauthorized" }
			}
			const sessionTtl = resolveSessionTtl(db, env)
			const issued = await sessions.rotate(sessionTtl)
			writeSessionCookie(reply, issued.sealed, env, sessionTtl)
			return { authenticated: true, configured: true }
		},
	)

	app.post(
		"/auth/password",
		{
			config: { rateLimit: passwordRateLimit },
		},
		async (req, reply) => {
			const cookie = req.cookies[env.SESSION_COOKIE_NAME]
			const session = await sessions.touch(cookie, resolveSessionTtl(db, env))
			if (session === undefined) {
				reply.code(401)
				return { error: "unauthorized" }
			}
			const parsed = changePasswordRequest.safeParse(req.body)
			if (!parsed.success) {
				reply.code(400)
				return { error: "invalid body" }
			}
			const auth = getAuthRow(db)
			if (auth === undefined) {
				reply.code(409)
				return { error: "not configured" }
			}
			const { currentPassword, newPassword } = parsed.data
			const ok = await verifyPassword(auth.hash, currentPassword, req.log)
			if (!ok) {
				reply.code(403)
				return { error: "incorrect password" }
			}
			setAuthRow(db, {
				hash: await hashPassword(newPassword),
				updatedAt: Date.now(),
			})
			return { ok: true as const }
		},
	)

	app.post("/auth/logout", async (_req, reply) => {
		// Sessions are stateless cookies -- clearing the cookie is the only
		// step needed. (A revoked-id deny-list would go here if we ever
		// needed pre-expiry revocation.)
		clearSessionCookie(reply, env)
		return { ok: true as const }
	})
}

export { cookieOptions }
