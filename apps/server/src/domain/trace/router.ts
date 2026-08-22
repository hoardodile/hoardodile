import { clientPlatform, usageReportGranularity } from "@hoardodile/schemas"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { z } from "zod"
import { TRACE_ACTIONS, TRACE_ENTITY_TYPES } from "./actions.ts"
import type { TraceService } from "./service.ts"

export const MAX_TRACE_PAGE_SIZE = 100

/**
 * tRPC sub-router for the user-footprint (event log) module.
 */
export function buildTraceRouter(service: TraceService) {
	return router({
		timeline: authedProcedure
			.input(
				z.object({
					page: z.number().int().min(1).default(1),
					limit: z.number().int().min(1).max(MAX_TRACE_PAGE_SIZE).default(50),
					action: z.enum(TRACE_ACTIONS).optional(),
					entityType: z.enum(TRACE_ENTITY_TYPES).optional(),
					platform: clientPlatform.optional(),
				}),
			)
			.query(({ input }) => service.timeline(input)),
		report: authedProcedure
			.input(
				z.object({
					granularity: usageReportGranularity,
					periods: z.number().int().min(1).max(120),
					timeZone: z.string().min(1),
					action: z.enum(TRACE_ACTIONS).optional(),
					platform: clientPlatform.optional(),
				}),
			)
			.query(({ input }) => service.report(input)),
		clearAll: writeProcedure.mutation(() => service.clearAll()),
	})
}

export type TraceRouter = ReturnType<typeof buildTraceRouter>
