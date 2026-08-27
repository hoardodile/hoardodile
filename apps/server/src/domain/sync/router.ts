import {
	syncDeviceCreateInput,
	syncDeviceUpdateInput,
	syncRecordCreateInput,
} from "@hoardodile/schemas"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type { SyncService } from "./service.ts"

/**
 * tRPC sub-router for the device-record module. Reads are auth-guarded;
 * writes use {@link writeProcedure} so read-only archive views stay
 * protected.
 */
export function buildSyncRouter(service: SyncService) {
	return router({
		deviceCreate: writeProcedure
			.input(syncDeviceCreateInput)
			.mutation(({ input }) => service.deviceCreate(input)),
		deviceUpdate: writeProcedure
			.input(syncDeviceUpdateInput)
			.mutation(({ input }) => service.deviceUpdate(input)),
		deviceDelete: writeProcedure
			.input(z.object({ id: z.string().min(1) }))
			.mutation(({ input }) => service.deviceRemove(input.id)),
		recordCreate: writeProcedure
			.input(syncRecordCreateInput)
			.mutation(({ input }) => service.recordCreate(input)),
		/** Live library state, diffed client-side against each device's
		    latest snapshot; only the sync page polls this. */
		current: authedProcedure.query(() => service.current()),
		summary: authedProcedure.query(() => service.summary()),
	})
}

export type SyncRouter = ReturnType<typeof buildSyncRouter>
