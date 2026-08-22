import {
	clientPlatform,
	usageDailySummaryInput,
	usageEntityExposureInput,
	usageHourlyWindowInput,
	usagePeriodSummaryInput,
	usageRecommendationsInput,
	usageSessionBeatInput,
	usageTimelineInput,
	usageTotalsInput,
	usageTrendInput,
} from "@hoardodile/schemas"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type { UsageService } from "./service.ts"

/**
 * tRPC sub-router for the usage stats module.
 */
export function buildUsageRouter(service: UsageService) {
	return router({
		recordSessionBeat: writeProcedure
			.input(usageSessionBeatInput)
			.mutation(({ input }) => service.recordSessionBeat(input)),
		listTotals: authedProcedure
			.input(usageTotalsInput)
			.query(({ input }) => service.getTotals(input)),
		totalsPage: authedProcedure
			.input(usageTotalsInput)
			.query(({ input }) => service.getTotalsPage(input)),
		dashboard: authedProcedure
			.input(
				z
					.object({
						platform: clientPlatform.optional(),
					})
					.optional(),
			)
			.query(({ input }) => service.getDashboard(input ?? {})),
		recommendations: authedProcedure
			.input(usageRecommendationsInput)
			.query(({ input }) => service.getRecommendations(input)),
		timeline: authedProcedure
			.input(usageTimelineInput)
			.query(({ input }) => service.getTimeline(input)),
		dailySummary: authedProcedure
			.input(usageDailySummaryInput)
			.query(({ input }) => service.getDailySummary(input)),
		trend: authedProcedure
			.input(usageTrendInput)
			.query(({ input }) => service.getTrend(input)),
		periodSummary: authedProcedure
			.input(usagePeriodSummaryInput)
			.query(({ input }) => service.getPeriodSummary(input)),
		hourlyWindow: authedProcedure
			.input(usageHourlyWindowInput)
			.query(({ input }) => service.getHourlyWindow(input)),
		entityExposure: authedProcedure
			.input(usageEntityExposureInput)
			.query(({ input }) => service.getEntityExposure(input)),
		clearAll: writeProcedure.mutation(() => service.clearAll()),
	})
}

export type UsageRouter = ReturnType<typeof buildUsageRouter>
