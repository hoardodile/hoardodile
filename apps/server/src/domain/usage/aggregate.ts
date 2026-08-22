import type { UsageEntityType } from "@hoardodile/schemas"
import { overlapMs } from "./lib/time.ts"

export type TopOrder = "time" | "recent" | "views"

/** One per-entity aggregate row; mutated in place while accumulating. */
export type TopRow = {
	entityType: UsageEntityType
	entityId: string
	totalMs: number
	viewCount: number
	lastViewedAt: number | null
}

export type PeriodBounds = { readonly start: number; readonly end: number }

/**
 * A session or association row that can be clipped against a period.
 * `sessionId` identifies the underlying viewing session so association
 * view counts can be deduplicated.
 */
export type ClippedRow = {
	readonly entityType: string
	readonly entityId: string
	readonly sessionId: string
	readonly startedAt: number
	readonly endedAt: number
}

/** Rank two aggregate rows by the requested order; ties fall back to insertion order. */
export function compareTopRows(a: TopRow, b: TopRow, order: TopOrder): number {
	if (order === "recent") {
		return (b.lastViewedAt ?? 0) - (a.lastViewedAt ?? 0)
	}
	if (order === "views") {
		return b.viewCount - a.viewCount
	}
	return b.totalMs - a.totalMs
}

export function maxLastViewed(
	a: number | null,
	b: number | null,
): number | null {
	if (a === null) return b
	if (b === null) return a
	return a > b ? a : b
}

export function sortTopRows(
	rows: readonly TopRow[],
	order: TopOrder,
): TopRow[] {
	return [...rows].sort((a, b) => compareTopRows(a, b, order))
}

/**
 * Merge the direct and associated top-N streams into one ranked list.
 * Entities present in both streams add their durations (associated rows
 * never contribute a view count of their own); entities seen only in the
 * associated stream keep a zero view count.
 */
export function mergeTopRows(
	direct: readonly TopRow[],
	associated: readonly TopRow[],
	order: TopOrder,
	limit: number,
): TopRow[] {
	const map = new Map<string, TopRow>()
	for (const row of direct) {
		map.set(row.entityId, row)
	}
	for (const row of associated) {
		const existing = map.get(row.entityId)
		if (existing === undefined) {
			map.set(row.entityId, { ...row, viewCount: 0 })
		} else {
			map.set(row.entityId, {
				...existing,
				totalMs: existing.totalMs + row.totalMs,
				lastViewedAt: maxLastViewed(existing.lastViewedAt, row.lastViewedAt),
			})
		}
	}
	return [...map.values()]
		.sort((a, b) => compareTopRows(a, b, order))
		.slice(0, limit)
}

/**
 * How many candidate rows the direct+associated merge fetches before
 * sorting: enough to cover `offset + limit` after merging both streams,
 * capped so a deep page cannot scan the whole table.
 */
const MERGE_FETCH_MULTIPLIER = 2
const MAX_MERGE_FETCH = 100
export function mergeFetchLimit(offset: number, limit: number): number {
	return Math.min((offset + limit) * MERGE_FETCH_MULTIPLIER, MAX_MERGE_FETCH)
}

/**
 * Accumulate one clipped session/association row into the aggregate
 * map: adds the overlap, applies a view-count delta, and advances the
 * last-viewed timestamp. Rows are keyed by `entityType:entityId` so
 * distinct entity kinds never collide.
 */
export function upsertAggregate(
	map: Map<string, TopRow>,
	input: {
		readonly entityType: UsageEntityType
		readonly entityId: string
		readonly clippedMs: number
		readonly endedAt: number
		readonly viewDelta: number
	},
): void {
	const { entityType, entityId, clippedMs, endedAt, viewDelta } = input
	const key = `${entityType}:${entityId}`
	const existing = map.get(key)
	if (existing !== undefined) {
		existing.totalMs += clippedMs
		existing.viewCount += viewDelta
		existing.lastViewedAt = maxLastViewed(existing.lastViewedAt, endedAt)
		return
	}
	map.set(key, {
		entityType,
		entityId,
		totalMs: clippedMs,
		viewCount: viewDelta,
		lastViewedAt: endedAt,
	})
}

/**
 * Aggregate session/association rows into per-entity totals, clipping
 * every row to `bounds`. Rows whose clipped overlap is zero are skipped.
 * With `dedupeViewsBySession`, the view count advances once per distinct
 * session instead of once per row (used for association streams that
 * repeat the same session for each linked entity).
 */
export function aggregateClippedRows(
	rows: readonly ClippedRow[],
	entityType: UsageEntityType | undefined,
	bounds: PeriodBounds,
	options: { readonly dedupeViewsBySession?: boolean } = {},
): Map<string, TopRow> {
	const dedupeViews = options.dedupeViewsBySession === true
	const sessionIds = dedupeViews ? new Map<string, Set<string>>() : undefined
	const map = new Map<string, TopRow>()
	for (const row of rows) {
		if (entityType !== undefined && row.entityType !== entityType) continue
		const clipped = overlapMs(
			row.startedAt,
			row.endedAt,
			bounds.start,
			bounds.end,
		)
		if (clipped === 0) continue
		let viewDelta = 1
		if (dedupeViews) {
			const key = `${row.entityType}:${row.entityId}`
			const seen = sessionIds!.get(key)
			const isNewSession = seen === undefined || !seen.has(row.sessionId)
			if (seen === undefined) {
				sessionIds!.set(key, new Set([row.sessionId]))
			} else if (isNewSession) {
				seen.add(row.sessionId)
			}
			if (!isNewSession) viewDelta = 0
		}
		upsertAggregate(map, {
			entityType: row.entityType as UsageEntityType,
			entityId: row.entityId,
			clippedMs: clipped,
			endedAt: row.endedAt,
			viewDelta,
		})
	}
	return map
}
