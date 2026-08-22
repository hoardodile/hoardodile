import type { ClientPlatform } from "@hoardodile/schemas"
import { and, desc, eq, gte, lt, sql } from "drizzle-orm"
import type { DbClient } from "src/infra/db/connection.ts"
import type { TraceAction, TraceEntityType } from "./actions.ts"
import { type UserActionInsert, userActions } from "./schema.ts"

export type TraceTimelinePage = {
	readonly rows: readonly (typeof userActions.$inferSelect)[]
	/** Number of rows matching the current filters, independent of paging. */
	readonly total: number
}

export type TraceTimelineQuery = {
	/** 1-based page index (newest-first stream). */
	readonly page: number
	readonly limit: number
	readonly action?: TraceAction
	readonly entityType?: TraceEntityType
	readonly platform?: ClientPlatform
}

export type TraceActionCount = {
	readonly action: TraceAction
	readonly count: number
}

export type TraceReportQuery = {
	readonly periods: readonly { readonly start: number; readonly end: number }[]
	readonly action?: TraceAction
	readonly platform?: ClientPlatform
}

export type UserActionRepository = {
	insert(row: UserActionInsert): void
	/** Newest-first page of events (1-based `page`), optional filters. */
	timeline(query: TraceTimelineQuery): TraceTimelinePage
	/**
	 * Per-action counts for each period, aligned with the input array
	 * (`result[i]` aggregates events in `periods[i]`).
	 */
	reportByPeriod(
		query: TraceReportQuery,
	): readonly (readonly TraceActionCount[])[]
	/** Wipe every event (Settings → App → clear footprints). */
	removeAll(): void
}

export function buildUserActionRepository(
	client: DbClient,
): UserActionRepository {
	function insert(row: UserActionInsert): void {
		client.insert(userActions).values(row).run()
	}

	function timeline(query: TraceTimelineQuery): TraceTimelinePage {
		const filters: ReturnType<typeof eq>[] = []
		if (query.action !== undefined) {
			filters.push(eq(userActions.action, query.action))
		}
		if (query.entityType !== undefined) {
			filters.push(eq(userActions.entityType, query.entityType))
		}
		if (query.platform !== undefined) {
			filters.push(eq(userActions.platform, query.platform))
		}
		const where = filters.length > 0 ? and(...filters) : undefined
		const rows = client
			.select()
			.from(userActions)
			.where(where)
			.orderBy(desc(userActions.createdAt), desc(userActions.id))
			.limit(query.limit + 1)
			.offset((query.page - 1) * query.limit)
			.all()
		const hasMore = rows.length > query.limit
		return {
			rows: hasMore ? rows.slice(0, query.limit) : rows,
			total: countRows(filters),
		}
	}

	function countRows(filters: readonly ReturnType<typeof eq>[]): number {
		const row = client
			.select({ value: sql<number>`count(*)` })
			.from(userActions)
			.where(filters.length > 0 ? and(...filters) : undefined)
			.get()
		return row?.value ?? 0
	}

	function reportByPeriod(
		query: TraceReportQuery,
	): readonly (readonly TraceActionCount[])[] {
		const filters: ReturnType<typeof eq>[] = []
		if (query.action !== undefined) {
			filters.push(eq(userActions.action, query.action))
		}
		if (query.platform !== undefined) {
			filters.push(eq(userActions.platform, query.platform))
		}
		const base = filters.length > 0 ? and(...filters) : undefined
		return query.periods.map((period) => {
			const rows = client
				.select({
					action: userActions.action,
					count: sql<number>`count(*)`,
				})
				.from(userActions)
				.where(
					and(
						base,
						gte(userActions.createdAt, period.start),
						lt(userActions.createdAt, period.end),
					),
				)
				.groupBy(userActions.action)
				.all()
			return rows.map((row) => ({ action: row.action, count: row.count }))
		})
	}

	function removeAll(): void {
		client.delete(userActions).run()
	}

	return { insert, timeline, reportByPeriod, removeAll }
}
