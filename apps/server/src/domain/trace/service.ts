import type {
	ClientPlatform,
	UsageReportGranularity,
} from "@hoardodile/schemas"
import { getTrendPeriods } from "src/domain/usage/lib/time.ts"
import { type DbServiceDeps, resolveClock } from "src/infra/service.ts"
import { getRequestPlatform } from "src/infra/trpc/device-context.ts"
import type { TraceAction, TraceEntityType, UserAction } from "./actions.ts"
import {
	buildUserActionRepository,
	type TraceActionCount,
	type TraceTimelinePage,
} from "./repo.ts"

export const DEFAULT_TRACE_PAGE_SIZE = 50

export type TraceServiceDeps = DbServiceDeps

export type TraceTimelineInput = {
	/** 1-based page index (newest-first stream). */
	readonly page?: number
	readonly limit?: number
	readonly action?: TraceAction
	readonly entityType?: TraceEntityType
	readonly platform?: ClientPlatform
}

export type TraceReportInput = {
	readonly granularity: UsageReportGranularity
	/** Number of trailing periods to aggregate, ending at the current one. */
	readonly periods: number
	/** Resolved IANA zone; `"local"` must be resolved client-side. */
	readonly timeZone: string
	readonly action?: TraceAction
	readonly platform?: ClientPlatform
}

export type TraceReportPeriod = {
	readonly period: string
	readonly rows: readonly TraceActionCount[]
}

export type TraceService = {
	/** Append one event row. Called synchronously by domain services. */
	record(input: UserAction): void
	/** Newest-first cursor-paged footprint stream. */
	timeline(input: TraceTimelineInput): Promise<TraceTimelinePage>
	/** Per-action counts across trailing periods in the user's time zone. */
	report(input: TraceReportInput): Promise<readonly TraceReportPeriod[]>
	/** Wipe every footprint (Settings → App). */
	clearAll(): Promise<void>
}

/**
 * Append-only user-action log. The record path is synchronous on purpose:
 * callers (res service callbacks) rely on the row landing before their
 * own mutation returns.
 */
export function createTraceService(deps: TraceServiceDeps): TraceService {
	const repo = buildUserActionRepository(deps.db)
	const { now, newId } = resolveClock(deps)

	function record(input: UserAction): void {
		repo.insert({
			id: newId(),
			action: input.action,
			entityType: input.entityType,
			entityId: input.entityId,
			entityName: input.entityName,
			detail: input.detail ?? {},
			platform: getRequestPlatform(),
			createdAt: now(),
		})
	}

	function timeline(input: TraceTimelineInput): TraceTimelinePage {
		return repo.timeline({
			page: input.page ?? 1,
			limit: input.limit ?? DEFAULT_TRACE_PAGE_SIZE,
			action: input.action,
			entityType: input.entityType,
			platform: input.platform,
		})
	}

	function report(input: TraceReportInput): readonly TraceReportPeriod[] {
		const bounds = getTrendPeriods(
			input.granularity,
			input.periods,
			now(),
			input.timeZone,
		)
		const counts = repo.reportByPeriod({
			periods: bounds.map((b) => ({ start: b.start, end: b.end })),
			action: input.action,
			platform: input.platform,
		})
		return bounds.map((b, i) => ({
			period: b.period,
			rows: counts[i] ?? [],
		}))
	}

	function clearAll(): void {
		repo.removeAll()
	}

	return {
		record,
		timeline: async (input) => timeline(input),
		report: async (input) => report(input),
		clearAll: async () => clearAll(),
	}
}
