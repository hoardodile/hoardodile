import {
	authedProcedure,
	publicProcedure,
	router,
} from "src/infra/trpc/core.ts"

/**
 * tRPC procedures that cover the auth surface exposed to the browser. The
 * password-handling side of auth is its own HTTP surface (`/auth/login`,
 * `/auth/logout`, `/auth/status`) so it can set cookies; only the session
 * echo lives here.
 */
export const authRouter = router({
	/** Public heartbeat - useful for cold-path connectivity checks. */
	ping: publicProcedure.query(() => ({ ok: true as const })),
	/** Session introspection for the currently authenticated caller. */
	me: authedProcedure.query(({ ctx }) => ({
		authenticated: ctx.authenticated,
		sessionId: ctx.sessionId,
	})),
})
