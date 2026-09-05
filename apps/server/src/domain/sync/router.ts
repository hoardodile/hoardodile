import {
	syncDeviceCreateInput,
	syncDeviceUpdateInput,
	syncRecordCreateInput,
} from "@hoardodile/schemas"
import { authedProcedure, router } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type { SyncService } from "./service.ts"

/**
 * tRPC sub-router for the device-record module. Reads are auth-guarded;
 * writes use {@link writeProcedure} so read-only archive views stay
 * protected.
 */
export function buildSyncRouter(service: SyncService) {
	return router({
		remindDays: authedProcedure
			.input(z.object({ days: z.number().int().min(1).max(365) }))
			.mutation(({ input }) => service.setRemindDays(input.days)),
		deviceCreate: authedProcedure
			.input(syncDeviceCreateInput)
			.mutation(({ input }) => service.deviceCreate(input)),
		deviceUpdate: authedProcedure
			.input(syncDeviceUpdateInput)
			.mutation(({ input }) => service.deviceUpdate(input)),
		deviceDelete: authedProcedure
			.input(z.object({ id: z.string().min(1) }))
			.mutation(({ input }) => service.deviceRemove(input.id)),
		recordCreate: authedProcedure
			.input(syncRecordCreateInput)
			.mutation(({ input }) => service.recordCreate(input)),
		/** Live library state, diffed client-side against each device's
		    latest snapshot; only the sync page polls this. */
		current: authedProcedure.query(() => service.current()),
		summary: authedProcedure.query(() => service.summary()),
	})
}

export type SyncRouter = ReturnType<typeof buildSyncRouter>
