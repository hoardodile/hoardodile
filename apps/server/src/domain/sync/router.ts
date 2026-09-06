import { authedProcedure, router } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type { SyncService } from "./service.ts"

/**
 * tRPC sub-router for the sync-reminder module. Reads are auth-guarded;
 * the write uses {@link writeProcedure} so read-only archive views stay
 * protected.
 */
export function buildSyncRouter(service: SyncService) {
	return router({
		remindDays: authedProcedure
			.input(z.object({ days: z.number().int().min(1).max(365) }))
			.mutation(({ input }) => service.setRemindDays(input.days)),
		summary: authedProcedure.query(() => service.summary()),
	})
}

export type SyncRouter = ReturnType<typeof buildSyncRouter>
