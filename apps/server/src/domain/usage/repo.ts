import {
	and,
	asc,
	desc,
	eq,
	gte,
	inArray,
	lt,
	type SQL,
	sql,
} from "drizzle-orm"
import type { DbClient } from "src/infra/db/connection.ts"
import {
	type UsageSessionAssociationRow,
	type UsageSessionRow,
	usageSessionAssociations,
	usageSessions,
} from "./schema.ts"

export type SessionQueryFilters = {
	readonly from?: number
	readonly to?: number
	readonly platform?: string
}

export type UsageSessionsRepository = {
	/** Insert a new session or update `endedAt`/`durationMs`/`updatedAt`. */
	upsert(session: UsageSessionRow): void

	/** Fetch a session by id. */
	findById(id: string): UsageSessionRow | undefined

	/**
	 * Aggregate primary sessions for an entity. Returns total duration,
	 * session count, and the latest session end.
	 */
	aggregatePrimary(
		entityType: string,
		entityId: string,
		filters?: SessionQueryFilters,
	): {
		totalMs: number
		viewCount: number
		lastViewedAt: number | null
	}

	/** Sum duration of primary sessions across the given entity types. */
	sumDurationByEntityTypes(
		entityTypes: readonly string[],
		filters?: SessionQueryFilters,
	): number

	/** Count primary sessions across the given entity types. */
	countSessionsByEntityTypes(
		entityTypes: readonly string[],
		filters?: SessionQueryFilters,
	): number

	/** Latest session end across all sessions, or undefined. */
	latestHeartbeat(): number | undefined

	/** Sessions for recently viewed primary entities with a minimum duration. */
	findContinue(
		entityTypes: readonly string[],
		minDurationMs: number,
		since: number,
		limit: number,
	): readonly UsageSessionRow[]

	/** Primary entities with the most total viewing time. */
	findTopCandidates(
		entityTypes: readonly string[],
		limit: number,
	): readonly {
		entityType: string
		entityId: string
		totalMs: number
		lastViewedAt: number | null
	}[]

	/** Top-N primary entities of a single type ordered by time or recency. */
	listTop(
		entityType: string,
		filters: SessionQueryFilters,
		order: "time" | "recent" | "views",
		limit: number,
		offset: number,
	): readonly {
		entityId: string
		totalMs: number
		viewCount: number
		lastViewedAt: number | null
	}[]

	/** Count distinct primary entities of a single type matching the filters. */
	countTop(entityType: string, filters: SessionQueryFilters): number

	/** Distinct primary entity ids matching the filters, unordered. */
	listTopEntityIds(
		entityType: string,
		filters: SessionQueryFilters,
	): readonly string[]

	/** Sessions matching the optional filters, ordered by recency. */
	findTimeline(
		filters: SessionQueryFilters & {
			entityType?: string
			entityId?: string
			limit: number
		},
	): readonly UsageSessionRow[]

	/** All sessions that overlap the given time range. */
	findInRange(
		filters: SessionQueryFilters & {
			from: number
			to: number
		},
	): readonly UsageSessionRow[]

	/**
	 * Sessions in a range with only the columns trend bucketing needs —
	 * avoids materializing every full row for N-bucket trend queries.
	 */
	findInRangeLight(
		filters: SessionQueryFilters & {
			from: number
			to: number
		},
	): readonly {
		entityType: string
		startedAt: number
		endedAt: number
	}[]

	/** Start of the earliest session matching the filters, or null. */
	findEarliestStartedAt(filters?: SessionQueryFilters): number | null
}

export type UsageSessionAssociationsRepository = {
	/**
	 * Attach an associated entity to a session. Idempotent: duplicate keys
	 * are ignored.
	 */
	upsert(
		sessionId: string,
		entityType: string,
		entityId: string,
		associationKind: string,
	): void

	/** All associations for a given session. */
	listBySession(sessionId: string): readonly UsageSessionAssociationRow[]

	/**
	 * Aggregate exposure time for an entity that was seen through
	 * associations. Returns total duration and session count.
	 */
	aggregateAssociated(
		entityType: string,
		entityId: string,
		filters?: {
			readonly from?: number
			readonly to?: number
		},
	): {
		totalMs: number
		sessionCount: number
		lastViewedAt: number | null
	}

	/** Top-N associated entities of a single type ordered by time or recency. */
	listTopAssociated(
		entityType: string,
		filters: SessionQueryFilters,
		order: "time" | "recent" | "views",
		limit: number,
		offset: number,
	): readonly {
		entityId: string
		totalMs: number
		sessionCount: number
		lastViewedAt: number | null
	}[]

	/** Count distinct associated entities of a single type matching the filters. */
	countTopAssociated(entityType: string, filters: SessionQueryFilters): number

	/** Distinct associated entity ids matching the filters, unordered. */
	listTopAssociatedEntityIds(
		entityType: string,
		filters: SessionQueryFilters,
	): readonly string[]

	/** Association rows with parent session timing in a range. */
	findInRange(
		filters: SessionQueryFilters & {
			from: number
			to: number
		},
	): readonly {
		entityType: string
		entityId: string
		sessionId: string
		startedAt: number
		endedAt: number
		durationMs: number
	}[]
}

function buildRangeConditions(from?: number, to?: number): SQL<unknown>[] {
	const conditions: SQL<unknown>[] = []
	if (from !== undefined) {
		conditions.push(gte(usageSessions.endedAt, from))
	}
	if (to !== undefined) {
		conditions.push(lt(usageSessions.startedAt, to))
	}
	return conditions
}

function appendSessionFilters(
	conditions: SQL<unknown>[],
	filters?: SessionQueryFilters,
): void {
	if (filters?.platform !== undefined) {
		conditions.push(eq(usageSessions.platform, filters.platform))
	}
}

export function buildUsageSessionsRepository(
	client: DbClient,
): UsageSessionsRepository {
	function upsert(session: UsageSessionRow): void {
		client
			.insert(usageSessions)
			.values(session)
			.onConflictDoUpdate({
				target: usageSessions.id,
				set: {
					endedAt: session.endedAt,
					durationMs: session.durationMs,
					updatedAt: session.updatedAt,
					platform: session.platform,
				},
			})
			.run()
	}

	function findById(id: string): UsageSessionRow | undefined {
		return client
			.select()
			.from(usageSessions)
			.where(eq(usageSessions.id, id))
			.get()
	}

	function aggregatePrimary(
		entityType: string,
		entityId: string,
		filters: SessionQueryFilters = {},
	): {
		totalMs: number
		viewCount: number
		lastViewedAt: number | null
	} {
		const conditions = [
			eq(usageSessions.entityType, entityType),
			eq(usageSessions.entityId, entityId),
			...buildRangeConditions(filters.from, filters.to),
		]
		appendSessionFilters(conditions, filters)

		const row = client
			.select({
				totalMs: sql<number>`coalesce(sum(${usageSessions.durationMs}), 0)`,
				viewCount: sql<number>`count(${usageSessions.id})`,
				lastViewedAt: sql<number | null>`max(${usageSessions.endedAt})`,
			})
			.from(usageSessions)
			.where(and(...conditions))
			.get()

		return {
			totalMs: row?.totalMs ?? 0,
			viewCount: row?.viewCount ?? 0,
			lastViewedAt: row?.lastViewedAt ?? null,
		}
	}

	function sumDurationByEntityTypes(
		entityTypes: readonly string[],
		filters: SessionQueryFilters = {},
	): number {
		const conditions = [
			inArray(usageSessions.entityType, entityTypes as string[]),
			...buildRangeConditions(filters.from, filters.to),
		]
		appendSessionFilters(conditions, filters)
		const row = client
			.select({
				total: sql<number>`coalesce(sum(${usageSessions.durationMs}), 0)`,
			})
			.from(usageSessions)
			.where(and(...conditions))
			.get()
		return row?.total ?? 0
	}

	function countSessionsByEntityTypes(
		entityTypes: readonly string[],
		filters: SessionQueryFilters = {},
	): number {
		const conditions = [
			inArray(usageSessions.entityType, entityTypes as string[]),
			...buildRangeConditions(filters.from, filters.to),
		]
		appendSessionFilters(conditions, filters)
		const row = client
			.select({
				total: sql<number>`count(${usageSessions.id})`,
			})
			.from(usageSessions)
			.where(and(...conditions))
			.get()
		return row?.total ?? 0
	}

	function latestHeartbeat(): number | undefined {
		const row = client
			.select({ max: sql<number | null>`max(${usageSessions.endedAt})` })
			.from(usageSessions)
			.get()
		return row?.max ?? undefined
	}

	function findContinue(
		entityTypes: readonly string[],
		minDurationMs: number,
		since: number,
		limit: number,
	): readonly UsageSessionRow[] {
		return client
			.select()
			.from(usageSessions)
			.where(
				and(
					inArray(usageSessions.entityType, entityTypes as string[]),
					gte(usageSessions.durationMs, minDurationMs),
					gte(usageSessions.endedAt, since),
				),
			)
			.orderBy(desc(usageSessions.endedAt))
			.limit(limit)
			.all()
	}

	function findTopCandidates(
		entityTypes: readonly string[],
		limit: number,
	): readonly {
		entityType: string
		entityId: string
		totalMs: number
		lastViewedAt: number | null
	}[] {
		return client
			.select({
				entityType: usageSessions.entityType,
				entityId: usageSessions.entityId,
				totalMs: sql<number>`sum(${usageSessions.durationMs})`,
				lastViewedAt: sql<number | null>`max(${usageSessions.endedAt})`,
			})
			.from(usageSessions)
			.where(inArray(usageSessions.entityType, entityTypes as string[]))
			.groupBy(usageSessions.entityType, usageSessions.entityId)
			.orderBy(desc(sql`sum(${usageSessions.durationMs})`))
			.limit(limit)
			.all()
	}

	function listTop(
		entityType: string,
		filters: SessionQueryFilters,
		order: "time" | "recent" | "views",
		limit: number,
		offset: number,
	): readonly {
		entityId: string
		totalMs: number
		viewCount: number
		lastViewedAt: number | null
	}[] {
		const conditions = [eq(usageSessions.entityType, entityType)]
		appendSessionFilters(conditions, filters)
		conditions.push(...buildRangeConditions(filters.from, filters.to))

		const orderBy =
			order === "recent"
				? desc(sql`max(${usageSessions.endedAt})`)
				: order === "views"
					? desc(sql`count(${usageSessions.id})`)
					: desc(sql`sum(${usageSessions.durationMs})`)

		return client
			.select({
				entityId: usageSessions.entityId,
				totalMs: sql<number>`sum(${usageSessions.durationMs})`,
				viewCount: sql<number>`count(${usageSessions.id})`,
				lastViewedAt: sql<number | null>`max(${usageSessions.endedAt})`,
			})
			.from(usageSessions)
			.where(and(...conditions))
			.groupBy(usageSessions.entityType, usageSessions.entityId)
			.orderBy(orderBy)
			.limit(limit)
			.offset(offset)
			.all()
	}

	function countTop(entityType: string, filters: SessionQueryFilters): number {
		const conditions = [eq(usageSessions.entityType, entityType)]
		appendSessionFilters(conditions, filters)
		conditions.push(...buildRangeConditions(filters.from, filters.to))

		const row = client
			.select({ count: sql<number>`count(distinct ${usageSessions.entityId})` })
			.from(usageSessions)
			.where(and(...conditions))
			.get()
		return row?.count ?? 0
	}

	function listTopEntityIds(
		entityType: string,
		filters: SessionQueryFilters,
	): readonly string[] {
		const conditions = [eq(usageSessions.entityType, entityType)]
		appendSessionFilters(conditions, filters)
		conditions.push(...buildRangeConditions(filters.from, filters.to))

		return client
			.selectDistinct({ entityId: usageSessions.entityId })
			.from(usageSessions)
			.where(and(...conditions))
			.all()
			.map((row) => row.entityId)
	}

	function findTimeline(
		filters: SessionQueryFilters & {
			entityType?: string
			entityId?: string
			limit: number
		},
	): readonly UsageSessionRow[] {
		const conditions: SQL<unknown>[] = []
		if (filters.entityType !== undefined) {
			conditions.push(eq(usageSessions.entityType, filters.entityType))
		}
		if (filters.entityId !== undefined) {
			conditions.push(eq(usageSessions.entityId, filters.entityId))
		}
		if (filters.from !== undefined) {
			conditions.push(gte(usageSessions.endedAt, filters.from))
		}
		if (filters.to !== undefined) {
			conditions.push(lt(usageSessions.startedAt, filters.to))
		}
		appendSessionFilters(conditions, filters)

		const whereClause = conditions.length > 0 ? and(...conditions) : undefined
		return client
			.select()
			.from(usageSessions)
			.where(whereClause)
			.orderBy(desc(usageSessions.startedAt))
			.limit(filters.limit)
			.all()
	}

	function findInRange(
		filters: SessionQueryFilters & {
			from: number
			to: number
		},
	): readonly UsageSessionRow[] {
		const conditions = [
			gte(usageSessions.endedAt, filters.from),
			lt(usageSessions.startedAt, filters.to),
		]
		appendSessionFilters(conditions, filters)
		return client
			.select()
			.from(usageSessions)
			.where(and(...conditions))
			.orderBy(desc(usageSessions.startedAt))
			.all()
	}

	function findInRangeLight(
		filters: SessionQueryFilters & {
			from: number
			to: number
		},
	): readonly {
		entityType: string
		startedAt: number
		endedAt: number
	}[] {
		const conditions = [
			gte(usageSessions.endedAt, filters.from),
			lt(usageSessions.startedAt, filters.to),
		]
		appendSessionFilters(conditions, filters)
		return client
			.select({
				entityType: usageSessions.entityType,
				startedAt: usageSessions.startedAt,
				endedAt: usageSessions.endedAt,
			})
			.from(usageSessions)
			.where(and(...conditions))
			.all()
	}

	function findEarliestStartedAt(filters?: SessionQueryFilters): number | null {
		const conditions: SQL<unknown>[] = []
		appendSessionFilters(conditions, filters)
		const row = client
			.select({ startedAt: usageSessions.startedAt })
			.from(usageSessions)
			.where(conditions.length > 0 ? and(...conditions) : undefined)
			.orderBy(asc(usageSessions.startedAt))
			.limit(1)
			.get()
		return row?.startedAt ?? null
	}

	return {
		upsert,
		findById,
		aggregatePrimary,
		sumDurationByEntityTypes,
		countSessionsByEntityTypes,
		latestHeartbeat,
		findContinue,
		findTopCandidates,
		listTop,
		countTop,
		listTopEntityIds,
		findTimeline,
		findInRange,
		findInRangeLight,
		findEarliestStartedAt,
	}
}

export function buildUsageSessionAssociationsRepository(
	client: DbClient,
): UsageSessionAssociationsRepository {
	function upsert(
		sessionId: string,
		entityType: string,
		entityId: string,
		associationKind: string,
	): void {
		client
			.insert(usageSessionAssociations)
			.values({ sessionId, entityType, entityId, associationKind })
			.onConflictDoNothing()
			.run()
	}

	function listBySession(
		sessionId: string,
	): readonly UsageSessionAssociationRow[] {
		return client
			.select()
			.from(usageSessionAssociations)
			.where(eq(usageSessionAssociations.sessionId, sessionId))
			.all()
	}

	function aggregateAssociated(
		entityType: string,
		entityId: string,
		filters: {
			readonly from?: number
			readonly to?: number
		} = {},
	): {
		totalMs: number
		sessionCount: number
		lastViewedAt: number | null
	} {
		const conditions = [
			eq(usageSessionAssociations.entityType, entityType),
			eq(usageSessionAssociations.entityId, entityId),
		]
		if (filters.from !== undefined) {
			conditions.push(gte(usageSessions.endedAt, filters.from))
		}
		if (filters.to !== undefined) {
			conditions.push(lt(usageSessions.startedAt, filters.to))
		}

		const row = client
			.select({
				totalMs: sql<number>`coalesce(sum(${usageSessions.durationMs}), 0)`,
				sessionCount: sql<number>`count(distinct ${usageSessions.id})`,
				lastViewedAt: sql<number | null>`max(${usageSessions.endedAt})`,
			})
			.from(usageSessionAssociations)
			.innerJoin(
				usageSessions,
				eq(usageSessionAssociations.sessionId, usageSessions.id),
			)
			.where(and(...conditions))
			.get()

		return {
			totalMs: row?.totalMs ?? 0,
			sessionCount: row?.sessionCount ?? 0,
			lastViewedAt: row?.lastViewedAt ?? null,
		}
	}

	function listTopAssociated(
		entityType: string,
		filters: SessionQueryFilters,
		order: "time" | "recent" | "views",
		limit: number,
		offset: number,
	): readonly {
		entityId: string
		totalMs: number
		sessionCount: number
		lastViewedAt: number | null
	}[] {
		const conditions = [
			eq(usageSessionAssociations.entityType, entityType),
			...buildRangeConditions(filters.from, filters.to),
		]
		appendSessionFilters(conditions, filters)

		const orderBy =
			order === "recent"
				? desc(sql`max(${usageSessions.endedAt})`)
				: order === "views"
					? desc(sql`count(distinct ${usageSessions.id})`)
					: desc(sql`sum(${usageSessions.durationMs})`)

		return client
			.select({
				entityId: usageSessionAssociations.entityId,
				totalMs: sql<number>`sum(${usageSessions.durationMs})`,
				sessionCount: sql<number>`count(distinct ${usageSessions.id})`,
				lastViewedAt: sql<number | null>`max(${usageSessions.endedAt})`,
			})
			.from(usageSessionAssociations)
			.innerJoin(
				usageSessions,
				eq(usageSessionAssociations.sessionId, usageSessions.id),
			)
			.where(and(...conditions))
			.groupBy(
				usageSessionAssociations.entityType,
				usageSessionAssociations.entityId,
			)
			.orderBy(orderBy)
			.limit(limit)
			.offset(offset)
			.all()
	}

	function countTopAssociated(
		entityType: string,
		filters: SessionQueryFilters,
	): number {
		const conditions = [
			eq(usageSessionAssociations.entityType, entityType),
			...buildRangeConditions(filters.from, filters.to),
		]
		appendSessionFilters(conditions, filters)

		const row = client
			.select({
				count: sql<number>`count(distinct ${usageSessionAssociations.entityId})`,
			})
			.from(usageSessionAssociations)
			.innerJoin(
				usageSessions,
				eq(usageSessionAssociations.sessionId, usageSessions.id),
			)
			.where(and(...conditions))
			.get()
		return row?.count ?? 0
	}

	function listTopAssociatedEntityIds(
		entityType: string,
		filters: SessionQueryFilters,
	): readonly string[] {
		const conditions = [
			eq(usageSessionAssociations.entityType, entityType),
			...buildRangeConditions(filters.from, filters.to),
		]
		appendSessionFilters(conditions, filters)

		return client
			.selectDistinct({
				entityId: usageSessionAssociations.entityId,
			})
			.from(usageSessionAssociations)
			.innerJoin(
				usageSessions,
				eq(usageSessionAssociations.sessionId, usageSessions.id),
			)
			.where(and(...conditions))
			.all()
			.map((row) => row.entityId)
	}

	function findInRange(
		filters: SessionQueryFilters & {
			from: number
			to: number
		},
	): readonly {
		entityType: string
		entityId: string
		sessionId: string
		startedAt: number
		endedAt: number
		durationMs: number
	}[] {
		const conditions = [...buildRangeConditions(filters.from, filters.to)]
		appendSessionFilters(conditions, filters)

		return client
			.select({
				entityType: usageSessionAssociations.entityType,
				entityId: usageSessionAssociations.entityId,
				sessionId: usageSessions.id,
				startedAt: usageSessions.startedAt,
				endedAt: usageSessions.endedAt,
				durationMs: usageSessions.durationMs,
			})
			.from(usageSessionAssociations)
			.innerJoin(
				usageSessions,
				eq(usageSessionAssociations.sessionId, usageSessions.id),
			)
			.where(and(...conditions))
			.all()
	}

	return {
		upsert,
		listBySession,
		aggregateAssociated,
		listTopAssociated,
		countTopAssociated,
		listTopAssociatedEntityIds,
		findInRange,
	}
}

/** Delete all usage sessions and their associations. */
export function deleteAllUsageData(client: DbClient): void {
	client.transaction((tx) => {
		tx.delete(usageSessionAssociations).run()
		tx.delete(usageSessions).run()
	})
}
