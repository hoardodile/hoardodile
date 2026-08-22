import { isDomainError } from "@hoardodile/shared"
import { initTRPC, TRPCError } from "@trpc/server"
import { toTRPCError } from "src/config/errors.ts"
import { type CommandDeps, runWrite } from "src/infra/command.ts"
import type { AppContext } from "./context.ts"

/**
 * tRPC root. Every module-level router is built from these exports so the
 * error formatter, context type, and middleware stay consistent without a
 * single god-file router.
 *
 * The error formatter enriches the wire payload with any `DomainError`
 * attached as `cause`, so the web client can branch on `kind` and `details`
 * without reparsing the message.
 */
const t = initTRPC.context<AppContext>().create({
	errorFormatter({ shape, error }) {
		const cause = error.cause
		if (isDomainError(cause)) {
			return {
				...shape,
				data: {
					...shape.data,
					domain: cause.toPayload(),
				},
			}
		}
		return shape
	},
})

export const router = t.router
export const mergeRouters = t.mergeRouters
export const publicProcedure = t.procedure

/**
 * Procedure that 401s unless the request carries a valid session, and
 * automatically translates any thrown {@link DomainError} into the
 * appropriate {@link TRPCError}. Domain routers never need a manual
 * `try/catch` or `guard()` wrapper — they call service methods directly.
 *
 * This builder also blocks mutations while the server is viewing a past
 * archive version. Queries remain available so the UI can render the
 * historical data; mutations would corrupt the immutable archive. The
 * "version" namespace is exempt so the user can switch back to the current
 * version from a read-only view.
 */
export const authedProcedure = t.procedure
	.use(({ ctx, next }) => {
		if (!ctx.authenticated) {
			throw new TRPCError({ code: "UNAUTHORIZED" })
		}
		return next({ ctx })
	})
	.use(({ ctx, type, next, path }) => {
		if (type === "mutation" && ctx.req.server.readOnly === true) {
			if (!path.startsWith("version.")) {
				throw new TRPCError({
					code: "FORBIDDEN",
					message:
						"server is viewing a read-only archive; mutations are blocked",
				})
			}
		}
		return next({ ctx })
	})
	.use(async ({ next }) => {
		try {
			return await next()
		} catch (err) {
			throw toTRPCError(err)
		}
	})

/**
 * Procedure for **write** mutations. Extends {@link authedProcedure} and
 * additionally:
 *
 * - routes the call through {@link runWrite} so the read-only gate is
 *   explicit and future write-side concerns (audit, transactions, etc.)
 *   have a single hook point;
 * - injects `ctx.writeDeps` ({@link CommandDeps}) so handlers can access the
 *   current db/paths/readOnly snapshot without reconstructing the object.
 *
 * Domain routers should use this for every mutation. Read-only queries
 * should continue to use `authedProcedure`.
 */
export const writeProcedure = authedProcedure.use(async ({ ctx, next }) => {
	const writeDeps: CommandDeps = {
		db: ctx.req.server.db,
		paths: ctx.req.server.paths,
		readOnly: ctx.req.server.readOnly,
	}
	return await runWrite(writeDeps, () =>
		next({
			ctx: {
				...ctx,
				writeDeps,
			},
		}),
	)
})
