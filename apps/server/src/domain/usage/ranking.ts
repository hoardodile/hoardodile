import { calendarDaysSince } from "./lib/time.ts"

/** Candidates viewed within this many calendar days qualify for "continue". */
export const CONTINUE_WINDOW_DAYS = 7
/** A session shorter than this is not worth continuing. */
export const CONTINUE_MIN_MS = 30_000
/** Half-life of the top-pick score decay, in days. */
export const TOP_PICK_HALF_LIFE_DAYS = 30

export type RecommendationCandidate = {
	readonly entityType: string
	readonly entityId: string
	readonly totalMs: number
	readonly lastViewedAt: number | null
}

/**
 * Rank candidates by recency, keeping only the most recent row per
 * entity and capping the result at `limit`.
 */
export function rankByRecency<T extends RecommendationCandidate>(
	rows: readonly T[],
	limit: number,
): T[] {
	const unique = new Map<string, T>()
	for (const row of rows) {
		const key = `${row.entityType}:${row.entityId}`
		const existing = unique.get(key)
		if (
			existing === undefined ||
			(row.lastViewedAt ?? 0) > (existing.lastViewedAt ?? 0)
		) {
			unique.set(key, row)
		}
	}
	return Array.from(unique.values())
		.sort((a, b) => (b.lastViewedAt ?? 0) - (a.lastViewedAt ?? 0))
		.slice(0, limit)
}

/**
 * Decay a candidate's raw viewing time by how many calendar days ago it
 * was last viewed, so a heavy user of the past is not endlessly
 * recommended at the top of the list.
 */
export function scoreTopPick(
	totalMs: number,
	lastViewedAt: number | null,
	ts: number,
	timeZone: string,
): number {
	const daysSince =
		lastViewedAt === null
			? Number.POSITIVE_INFINITY
			: calendarDaysSince(lastViewedAt, ts, timeZone)
	return totalMs * Math.exp((-Math.LN2 * daysSince) / TOP_PICK_HALF_LIFE_DAYS)
}

/**
 * Rank raw candidate rows by their decayed top-pick score and cap the
 * result at `limit`.
 */
export function rankTopPicks<T extends RecommendationCandidate>(
	rows: readonly T[],
	ts: number,
	timeZone: string,
	limit: number,
): T[] {
	return [...rows]
		.map((row) => ({
			row,
			score: scoreTopPick(row.totalMs, row.lastViewedAt, ts, timeZone),
		}))
		.sort((a, b) => b.score - a.score)
		.slice(0, limit)
		.map((item) => item.row)
}
