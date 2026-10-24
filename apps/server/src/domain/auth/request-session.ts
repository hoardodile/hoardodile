import type { FastifyReply, FastifyRequest } from "fastify"
import type { Env } from "src/config/env.ts"
import { writeSessionCookie } from "./cookie.ts"
import type { SessionStore } from "./session.ts"

/** An explicit page request never inherits another tab's cookie. */
export function requestSessionToken(
	req: FastifyRequest,
	env: Env,
): string | undefined {
	const authorization = req.headers.authorization
	if (authorization !== undefined) {
		return authorization.startsWith("Bearer ")
			? authorization.slice(7)
			: undefined
	}
	if (req.headers["x-hoardodile-session-mode"] === "page") return undefined
	return req.cookies[env.SESSION_COOKIE_NAME]
}

export async function touchRequestSession(options: {
	req: FastifyRequest
	reply: FastifyReply
	env: Env
	sessions: SessionStore
}) {
	const { req, reply, env, sessions } = options
	const touched = await sessions.touch(
		requestSessionToken(req, env),
		env.SESSION_TTL_SECONDS,
	)
	if (touched?.sealed !== undefined) {
		if (req.headers.authorization !== undefined) {
			reply.header("x-hoardodile-session", touched.sealed)
		} else {
			writeSessionCookie(reply, touched.sealed, env, env.SESSION_TTL_SECONDS)
		}
	}
	return touched
}
