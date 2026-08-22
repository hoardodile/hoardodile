import type {
	CharCard,
	ClientPlatform,
	ResCard,
	UsageDailySummary,
	UsageDailySummaryInput,
	UsageDashboard,
	UsageEntityExposure,
	UsageEntityExposureInput,
	UsageEntityType,
	UsageExposureMode,
	UsageHourlyWindow,
	UsageHourlyWindowInput,
	UsagePeriodSummary,
	UsagePeriodSummaryInput,
	UsageRecommendation,
	UsageRecommendationsInput,
	UsageSessionBeatInput,
	UsageTimelineInput,
	UsageTimelineItem,
	UsageTotal,
	UsageTotalsInput,
	UsageTotalsPage,
	UsageTrend,
	UsageTrendInput,
} from "@hoardodile/schemas"
import { eq } from "drizzle-orm"
import {
	type DbClient,
	type SqliteDb,
	withTransaction,
} from "src/infra/db/connection.ts"
import { type ClockDeps, resolveClock, wrapAsync } from "src/infra/service.ts"
import { filterExistingCharacterIds } from "../char/repo.ts"
import type { CharService } from "../char/service.ts"
import { filterExistingDocumentIds } from "../doc/repo.ts"
import { documents } from "../doc/schema.ts"
import type { DocService } from "../doc/service.ts"
import { filterExistingResourceIds } from "../res/repo.ts"
import { resCharacters, resources } from "../res/schema.ts"
import type { ResService } from "../res/service.ts"
import {
	aggregateClippedRows,
	type ClippedRow,
	maxLastViewed,
	mergeFetchLimit,
	mergeTopRows,
	type PeriodBounds,
	sortTopRows,
	type TopOrder,
	type TopRow,
	upsertAggregate,
} from "./aggregate.ts"
import {
	buildHourOfDayIndex,
	dayjsFor,
	getCalendarWindowStart,
	getDayBounds,
	getDayHourBuckets,
	getPeriodBounds,
	getTrendPeriods,
	overlapMs,
	requireIanaTimeZone,
	splitSessionIntoHourlyMs,
	splitSessionIntoHourOfDayMs,
} from "./lib/time.ts"
import {
	CONTINUE_MIN_MS,
	CONTINUE_WINDOW_DAYS,
	type RecommendationCandidate,
	rankByRecency,
	rankTopPicks,
} from "./ranking.ts"
import {
	buildUsageSessionAssociationsRepository,
	buildUsageSessionsRepository,
	deleteAllUsageData,
	type SessionQueryFilters,
} from "./repo.ts"

export type UsageServiceDeps = ClockDeps & {
	readonly db: SqliteDb
	/** Optional: required only for recommendation card resolution. */
	readonly resService?: ResService
	/** Optional: required only for recommendation card resolution. */
	readonly charService?: CharService
	/** Optional: required only for recommendation card resolution. */
	readonly docService?: DocService
}

export type UsageService = {
	recordSessionBeat(input: UsageSessionBeatInput): Promise<void>
	getTotals(input: UsageTotalsInput): Promise<readonly UsageTotal[]>
	getTotalsPage(input: UsageTotalsInput): Promise<UsageTotalsPage>
	getDashboard(input?: { platform?: ClientPlatform }): Promise<UsageDashboard>
	getRecommendations(
		input: UsageRecommendationsInput,
	): Promise<readonly UsageRecommendation[]>
	getTimeline(input: UsageTimelineInput): Promise<readonly UsageTimelineItem[]>
	getDailySummary(input: UsageDailySummaryInput): Promise<UsageDailySummary>
	getTrend(input: UsageTrendInput): Promise<UsageTrend>
	getPeriodSummary(input: UsagePeriodSummaryInput): Promise<UsagePeriodSummary>
	getEntityExposure(
		input: UsageEntityExposureInput,
	): Promise<UsageEntityExposure>
	getHourlyWindow(input: UsageHourlyWindowInput): Promise<UsageHourlyWindow>
	clearAll(): Promise<void>
}

/**
 * Build the usage statistics service.
 *
 * The session-based model keeps one row per viewing session in
 * `usage_sessions`. Related entities are attached in
 * `usage_session_associations` so that associated exposure can be reported
 * without inflating the primary totals.
 */
export function createUsageService(deps: UsageServiceDeps): UsageService {
	const db = deps.db
	const sessionsRepo = buildUsageSessionsRepository(db)
	const associationsRepo = buildUsageSessionAssociationsRepository(db)
	const { now, newId } = resolveClock(deps)

	function clientPlatformFilters(input: {
		platform?: ClientPlatform
	}): SessionQueryFilters {
		return {
			...(input.platform !== undefined ? { platform: input.platform } : {}),
		}
	}

	function buildEntityExistenceFilter(
		client: DbClient,
		entityType: UsageEntityType,
		ids: readonly string[],
	): Set<string> {
		if (ids.length === 0) return new Set()
		switch (entityType) {
			case "resource":
				return new Set(filterExistingResourceIds(client, ids))
			case "character":
				return new Set(filterExistingCharacterIds(client, ids))
			case "document":
				return new Set(filterExistingDocumentIds(client, ids))
			case "plugin":
				return new Set(ids)
		}
	}

	function filterRowsByExistingEntity<
		T extends { entityType: UsageEntityType; entityId: string },
	>(rows: readonly T[], client: DbClient): T[] {
		if (rows.length === 0) return []

		const idsByType = new Map<UsageEntityType, string[]>()
		for (const row of rows) {
			const list = idsByType.get(row.entityType) ?? []
			list.push(row.entityId)
			idsByType.set(row.entityType, list)
		}

		const existingKeys = new Set<string>()
		for (const [entityType, ids] of idsByType) {
			const existingIds = buildEntityExistenceFilter(client, entityType, ids)
			for (const id of existingIds) {
				existingKeys.add(`${entityType}:${id}`)
			}
		}

		return rows.filter((row) =>
			existingKeys.has(`${row.entityType}:${row.entityId}`),
		)
	}

	function countExistingTopEntities(
		entityType: UsageEntityType,
		filters: SessionQueryFilters,
		exposureMode: UsageExposureMode,
		bounds: PeriodBounds | undefined,
	): number {
		const effectiveFilters: SessionQueryFilters =
			bounds !== undefined &&
			filters.from !== undefined &&
			filters.to !== undefined
				? { ...filters, from: bounds.start, to: bounds.end }
				: filters

		const candidateIds = new Set<string>()
		if (exposureMode !== "associated") {
			for (const id of sessionsRepo.listTopEntityIds(
				entityType,
				effectiveFilters,
			)) {
				candidateIds.add(id)
			}
		}
		if (exposureMode !== "direct") {
			for (const id of associationsRepo.listTopAssociatedEntityIds(
				entityType,
				effectiveFilters,
			)) {
				candidateIds.add(id)
			}
		}

		const existing = buildEntityExistenceFilter(db, entityType, [
			...candidateIds,
		])
		return existing.size
	}

	/** Sessions repo rows normalized to the aggregate input shape. */
	function sessionRows(
		filters: SessionQueryFilters & { from: number; to: number },
	): ClippedRow[] {
		return sessionsRepo.findInRange(filters).map((s) => ({
			entityType: s.entityType,
			entityId: s.entityId,
			sessionId: s.id,
			startedAt: s.startedAt,
			endedAt: s.endedAt,
		}))
	}

	/** Common inputs of the top-N exposure queries. */
	type TopQuery = {
		readonly entityType: UsageEntityType
		readonly order: TopOrder
		readonly limit: number
		readonly offset: number
		readonly exposureMode: UsageExposureMode
	}

	/** The clipped variant additionally pins a period. */
	type TopQueryClipped = TopQuery & {
		readonly filters: SessionQueryFilters & { from: number; to: number }
		readonly bounds: PeriodBounds
	}

	/** The plain variant filters on session rows, optionally clipped. */
	type TopQueryUnclipped = TopQuery & {
		readonly filters: SessionQueryFilters
		readonly bounds?: PeriodBounds
	}

	function listTopForExposureClipped(
		query: TopQueryClipped,
	): readonly TopRow[] {
		const { entityType, filters, bounds, order, limit, offset, exposureMode } =
			query
		if (exposureMode === "direct") {
			return sortTopRows(
				[
					...aggregateClippedRows(
						sessionRows(filters),
						entityType,
						bounds,
					).values(),
				],
				order,
			).slice(offset, offset + limit)
		}
		if (exposureMode === "associated") {
			return sortTopRows(
				[
					...aggregateClippedRows(
						associationsRepo.findInRange(filters),
						entityType,
						bounds,
						{ dedupeViewsBySession: true },
					).values(),
				],
				order,
			).slice(offset, offset + limit)
		}
		const fetchLimit = mergeFetchLimit(offset, limit)
		return mergeTopRows(
			[
				...aggregateClippedRows(
					sessionRows(filters),
					entityType,
					bounds,
				).values(),
			],
			[
				...aggregateClippedRows(
					associationsRepo.findInRange(filters),
					entityType,
					bounds,
					{ dedupeViewsBySession: true },
				).values(),
			],
			order,
			fetchLimit,
		).slice(offset, offset + limit)
	}

	function listTopForExposure(query: TopQueryUnclipped): readonly TopRow[] {
		const { entityType, filters, order, limit, offset, exposureMode } = query
		if (
			query.bounds !== undefined &&
			filters.from !== undefined &&
			filters.to !== undefined
		) {
			return listTopForExposureClipped({
				entityType,
				order,
				limit,
				offset,
				exposureMode,
				filters: { ...filters, from: filters.from, to: filters.to },
				bounds: query.bounds,
			})
		}
		if (exposureMode === "direct") {
			return sessionsRepo
				.listTop(entityType, filters, order, limit, offset)
				.map((row) => ({ entityType, ...row }))
		}
		if (exposureMode === "associated") {
			return associationsRepo
				.listTopAssociated(entityType, filters, order, limit, offset)
				.map((row) => ({
					entityType,
					entityId: row.entityId,
					totalMs: row.totalMs,
					viewCount: row.sessionCount,
					lastViewedAt: row.lastViewedAt,
				}))
		}
		const fetchLimit = mergeFetchLimit(offset, limit)
		return mergeTopRows(
			sessionsRepo
				.listTop(entityType, filters, order, fetchLimit, 0)
				.map((row) => ({ entityType, ...row })),
			associationsRepo
				.listTopAssociated(entityType, filters, order, fetchLimit, 0)
				.map((row) => ({
					entityType,
					entityId: row.entityId,
					totalMs: row.totalMs,
					viewCount: row.sessionCount,
					lastViewedAt: row.lastViewedAt,
				})),
			order,
			fetchLimit,
		).slice(offset, offset + limit)
	}

	function mapTopRowsToTotals(
		rows: readonly TopRow[],
		input: {
			entityType: UsageTotalsInput["entityType"]
			granularity: UsageTotalsInput["granularity"]
			period: string | null
		},
	): UsageTotal[] {
		return rows.map((row) => ({
			id: newId(),
			entityType: input.entityType,
			entityId: row.entityId,
			granularity: input.granularity,
			period: input.period,
			totalMs: row.totalMs,
			viewCount: row.viewCount,
			lastViewedAt: row.lastViewedAt,
			updatedAt: row.lastViewedAt ?? now(),
		}))
	}

	function recordAssociations(
		client: DbClient,
		txAssociationsRepo: ReturnType<
			typeof buildUsageSessionAssociationsRepository
		>,
		sessionId: string,
		entityType: UsageEntityType,
		entityId: string,
	): void {
		switch (entityType) {
			case "resource": {
				const resRow = client
					.select({ contentPluginId: resources.contentPluginId })
					.from(resources)
					.where(eq(resources.id, entityId))
					.get()
				if (
					resRow?.contentPluginId !== undefined &&
					resRow.contentPluginId !== null
				) {
					txAssociationsRepo.upsert(
						sessionId,
						"plugin",
						resRow.contentPluginId,
						"owner",
					)
				}

				const charRows = client
					.select({ charId: resCharacters.charId })
					.from(resCharacters)
					.where(eq(resCharacters.resId, entityId))
					.all()
				for (const { charId } of charRows) {
					txAssociationsRepo.upsert(sessionId, "character", charId, "linked")
				}
				break
			}

			case "document": {
				const docRow = client
					.select({
						draftResIds: documents.draftResIds,
						draftCharIds: documents.draftCharIds,
					})
					.from(documents)
					.where(eq(documents.id, entityId))
					.get()
				if (docRow !== undefined) {
					for (const resId of docRow.draftResIds) {
						txAssociationsRepo.upsert(sessionId, "resource", resId, "contained")
					}
					for (const charId of docRow.draftCharIds) {
						txAssociationsRepo.upsert(
							sessionId,
							"character",
							charId,
							"contained",
						)
					}
				}
				break
			}

			case "character":
			case "plugin":
				break
		}
	}

	function recordSessionBeat(input: UsageSessionBeatInput): void {
		const ts = now()
		const { sessionId, entityType, entityId, startedAt, durationMs } = input
		if (durationMs <= 0) return

		const endedAt = startedAt + durationMs
		withTransaction(db, (tx) => {
			const txSessionsRepo = buildUsageSessionsRepository(tx)
			const existing = txSessionsRepo.findById(sessionId)
			// Monotonicity guard: ignore stale/out-of-order beats so offline
			// retries or duplicated flushes cannot regress recorded duration.
			if (existing !== undefined && durationMs <= existing.durationMs) {
				return
			}

			const txAssociationsRepo = buildUsageSessionAssociationsRepository(tx)
			txSessionsRepo.upsert({
				id: sessionId,
				entityType,
				entityId,
				startedAt,
				endedAt,
				durationMs,
				platform: input.platform ?? null,
				createdAt: existing?.createdAt ?? ts,
				updatedAt: ts,
			})
			recordAssociations(
				tx,
				txAssociationsRepo,
				sessionId,
				entityType,
				entityId,
			)
		})
	}

	/**
	 * Shared prelude of the totals queries: resolve the period bounds,
	 * build the session filters, and fetch the top rows for the page.
	 * `offset` is 0 for the plain totals and `(page - 1) * limit` for the
	 * paged variant.
	 */
	function resolveTotalsQuery(
		input: UsageTotalsInput,
		offset: number,
	): {
		readonly period: string | null
		readonly filters: SessionQueryFilters
		readonly rows: readonly TopRow[]
		readonly bounds: PeriodBounds | null
	} {
		const period =
			input.granularity !== "all" && input.period !== undefined
				? input.period
				: null
		const bounds =
			period !== null && input.granularity !== "all"
				? getPeriodBounds(
						input.granularity,
						period,
						requireIanaTimeZone(input.timeZone),
					)
				: input.from !== undefined && input.to !== undefined
					? { start: input.from, end: input.to }
					: null
		const filters: SessionQueryFilters = {
			...clientPlatformFilters(input),
			...(bounds !== null ? { from: bounds.start, to: bounds.end } : {}),
		}
		const rows = listTopForExposure({
			entityType: input.entityType,
			filters,
			order: input.order,
			limit: input.limit,
			offset,
			exposureMode: input.exposureMode ?? "direct",
			bounds: bounds ?? undefined,
		})
		return { period, filters, rows, bounds }
	}

	/** Drop aggregate rows whose entity no longer exists (was hard-deleted). */
	function filterToExisting(
		rows: readonly TopRow[],
		entityType: UsageEntityType,
		client: DbClient,
	): TopRow[] {
		if (rows.length === 0) return []
		const existingIds = buildEntityExistenceFilter(
			client,
			entityType,
			rows.map((row) => row.entityId),
		)
		return rows.filter((row) => existingIds.has(row.entityId))
	}

	function getTotals(input: UsageTotalsInput): readonly UsageTotal[] {
		const { period, rows } = resolveTotalsQuery(input, 0)
		return mapTopRowsToTotals(filterToExisting(rows, input.entityType, db), {
			entityType: input.entityType,
			granularity: input.granularity,
			period,
		})
	}

	function getTotalsPage(input: UsageTotalsInput): UsageTotalsPage {
		const page = input.page ?? 1
		const size = input.limit
		const offset = (page - 1) * size
		const { period, filters, rows, bounds } = resolveTotalsQuery(input, offset)
		const exposureMode = input.exposureMode ?? "direct"
		return {
			rows: mapTopRowsToTotals(filterToExisting(rows, input.entityType, db), {
				entityType: input.entityType,
				granularity: input.granularity,
				period,
			}),
			total: countExistingTopEntities(
				input.entityType,
				filters,
				exposureMode,
				bounds ?? undefined,
			),
			page,
			size,
		}
	}

	function getDashboard(
		input: { platform?: ClientPlatform } = {},
	): UsageDashboard {
		const primaryTypes: readonly UsageEntityType[] = [
			"resource",
			"document",
			"character",
		]
		const filters = clientPlatformFilters(input)
		const totalMs = sessionsRepo.sumDurationByEntityTypes(primaryTypes, filters)
		const totalViews = sessionsRepo.countSessionsByEntityTypes(
			primaryTypes,
			filters,
		)

		return {
			totalMs,
			totalViews,
			topResources: getTotals({
				entityType: "resource",
				granularity: "all",
				order: "time",
				limit: 10,
				platform: input.platform,
			}),
			topCharacters: getTotals({
				entityType: "character",
				granularity: "all",
				order: "time",
				limit: 10,
				platform: input.platform,
			}),
			topDocuments: getTotals({
				entityType: "document",
				granularity: "all",
				order: "time",
				limit: 10,
				platform: input.platform,
			}),
			topPlugins: getTotals({
				entityType: "plugin",
				granularity: "all",
				order: "time",
				limit: 10,
				platform: input.platform,
			}),
			recentActivity: getTotals({
				entityType: "resource",
				granularity: "all",
				order: "recent",
				limit: 10,
				platform: input.platform,
			}),
		}
	}

	async function resolveRecommendation(
		row: RecommendationCandidate,
	): Promise<UsageRecommendation | undefined> {
		const base = {
			entityType: row.entityType as UsageEntityType,
			entityId: row.entityId,
			totalMs: row.totalMs,
			lastViewedAt: row.lastViewedAt,
		}

		try {
			switch (row.entityType) {
				case "resource": {
					if (deps.resService === undefined) return undefined
					const resource = (await deps.resService.detailCard(
						row.entityId,
					)) as ResCard
					return { ...base, resource }
				}
				case "character": {
					if (deps.charService === undefined) return undefined
					const character = (await deps.charService.detailCard(
						row.entityId,
					)) as CharCard
					return { ...base, character }
				}
				case "document": {
					if (deps.docService === undefined) return undefined
					const doc = await deps.docService.detail(row.entityId)
					if (doc.kind !== "document") return undefined
					return {
						...base,
						document: { id: doc.id, title: doc.title },
					}
				}
				default:
					return undefined
			}
		} catch {
			// Deleted/trashed or missing entity — skip it.
			return undefined
		}
	}

	async function getRecommendations(
		input: UsageRecommendationsInput,
	): Promise<readonly UsageRecommendation[]> {
		const ts = now()
		const timeZone = requireIanaTimeZone(input.timeZone)
		if (input.kind === "continue") {
			const since = getCalendarWindowStart(ts, CONTINUE_WINDOW_DAYS, timeZone)
			const rows = sessionsRepo.findContinue(
				["resource", "document"],
				CONTINUE_MIN_MS,
				since,
				input.limit * 3,
			)
			const candidates = rankByRecency(
				rows.map((row) => ({
					entityType: row.entityType,
					entityId: row.entityId,
					totalMs: row.durationMs,
					lastViewedAt: row.endedAt,
				})),
				input.limit * 3,
			)
			const resolved = await Promise.all(candidates.map(resolveRecommendation))
			return resolved
				.filter((item): item is UsageRecommendation => item !== undefined)
				.slice(0, input.limit)
		}

		const rows = sessionsRepo.findTopCandidates(
			["resource", "character"],
			input.limit * 5,
		)
		const candidates = rankTopPicks(
			rows.map((row) => ({
				entityType: row.entityType as UsageEntityType,
				entityId: row.entityId,
				totalMs: row.totalMs,
				lastViewedAt: row.lastViewedAt,
			})),
			ts,
			timeZone,
			input.limit,
		)
		const resolved = await Promise.all(candidates.map(resolveRecommendation))
		return resolved.filter(
			(item): item is UsageRecommendation => item !== undefined,
		)
	}

	async function getTimeline(
		input: UsageTimelineInput,
	): Promise<readonly UsageTimelineItem[]> {
		const rows = sessionsRepo.findTimeline({
			entityType: input.entityType,
			entityId: input.entityId,
			from: input.from,
			to: input.to,
			platform: input.platform,
			limit: input.limit,
		})

		const sessionsWithAssociations = rows.map((row) => ({
			session: row,
			associations: associationsRepo.listBySession(row.id),
		}))

		return sessionsWithAssociations.map(({ session, associations }) => ({
			sessionId: session.id,
			entityType: session.entityType as UsageEntityType,
			entityId: session.entityId,
			startedAt: session.startedAt,
			endedAt: session.endedAt,
			durationMs: session.durationMs,
			platform: session.platform as ClientPlatform | null,
			associations: associations.map((a) => ({
				sessionId: a.sessionId,
				entityType: a.entityType as UsageEntityType,
				entityId: a.entityId,
				associationKind: a.associationKind as "owner" | "linked" | "contained",
			})),
		}))
	}

	function getDailySummary(input: UsageDailySummaryInput): UsageDailySummary {
		const timeZone = requireIanaTimeZone(input.timeZone)
		const { start, end } = getDayBounds(input.date, timeZone)
		const sessions = sessionsRepo.findInRange({
			from: start,
			to: end,
			platform: input.platform,
		})
		const { hourStarts, labels: hourlyLabels } = getDayHourBuckets(
			start,
			end,
			timeZone,
		)
		const hourlyMs = Array.from({ length: hourStarts.length }, () => 0)

		for (const session of sessions) {
			const buckets = splitSessionIntoHourlyMs(
				session.startedAt,
				session.endedAt,
				start,
				end,
				timeZone,
				hourStarts,
			)
			for (let i = 0; i < buckets.length; i++) {
				hourlyMs[i] = (hourlyMs[i] ?? 0) + (buckets[i] ?? 0)
			}
		}

		const entityMap = new Map<string, TopRow>()
		const totalMs = sessions.reduce(
			(sum, session) =>
				sum + overlapMs(session.startedAt, session.endedAt, start, end),
			0,
		)
		for (const session of sessions) {
			upsertAggregate(entityMap, {
				entityType: session.entityType as UsageEntityType,
				entityId: session.entityId,
				clippedMs: overlapMs(session.startedAt, session.endedAt, start, end),
				endedAt: session.endedAt,
				viewDelta: 0,
			})
		}

		const topEntities = filterRowsByExistingEntity(
			Array.from(entityMap.values()),
			db,
		)
			.sort((a, b) => b.totalMs - a.totalMs)
			.slice(0, input.limit)
			.map((entity) => ({
				id: entity.entityId,
				entityType: entity.entityType,
				entityId: entity.entityId,
				granularity: "all" as const,
				period: null,
				totalMs: entity.totalMs,
				viewCount: sessions.filter(
					(s) =>
						s.entityType === entity.entityType &&
						s.entityId === entity.entityId,
				).length,
				lastViewedAt: entity.lastViewedAt,
				updatedAt: entity.lastViewedAt ?? now(),
			}))

		return {
			date: input.date,
			totalMs,
			sessionCount: sessions.length,
			hourlyMs: hourlyMs.map((ms) => Math.round(ms)),
			hourlyLabels,
			topEntities,
		}
	}

	function getTrend(input: UsageTrendInput): UsageTrend {
		const ts = now()
		const timeZone = requireIanaTimeZone(input.timeZone)
		const buckets = getTrendPeriods(
			input.granularity,
			input.periods,
			ts,
			timeZone,
		)

		// One light scan over the whole window instead of one full-row
		// query per bucket (N+1): sessions are then clipped into their
		// buckets in a single JS pass, keeping the per-bucket overlap
		// semantics of the query-per-bucket version.
		const entityTypeFilter = input.entityType
		const first = buckets[0]!
		const last = buckets[buckets.length - 1]!
		const sessions = sessionsRepo.findInRangeLight({
			from: first.start,
			to: last.end,
			platform: input.platform,
		})

		const result = buckets.map((bucket) => {
			let totalMs = 0
			let sessionCount = 0
			for (const session of sessions) {
				if (
					entityTypeFilter !== undefined &&
					session.entityType !== entityTypeFilter
				) {
					continue
				}
				const clipped = overlapMs(
					session.startedAt,
					session.endedAt,
					bucket.start,
					bucket.end,
				)
				if (clipped === 0) continue
				totalMs += clipped
				sessionCount += 1
			}
			return {
				period: bucket.period,
				totalMs,
				sessionCount,
			}
		})

		return {
			granularity: input.granularity,
			buckets: result,
		}
	}

	function getPeriodSummary(
		input: UsagePeriodSummaryInput,
	): UsagePeriodSummary {
		const timeZone = requireIanaTimeZone(input.timeZone)
		const bounds = getPeriodBounds(input.granularity, input.period, timeZone)
		const filters = {
			...clientPlatformFilters(input),
			from: bounds.start,
			to: bounds.end,
		} satisfies SessionQueryFilters & { from: number; to: number }
		const sessions = sessionsRepo.findInRange(filters)
		const exposureMode = input.exposureMode ?? "direct"

		const entityMap = new Map<string, TopRow>()

		if (exposureMode === "direct" || exposureMode === "total") {
			for (const session of sessions) {
				upsertAggregate(entityMap, {
					entityType: session.entityType as UsageEntityType,
					entityId: session.entityId,
					clippedMs: overlapMs(
						session.startedAt,
						session.endedAt,
						bounds.start,
						bounds.end,
					),
					endedAt: session.endedAt,
					viewDelta: 1,
				})
			}
		}

		if (exposureMode === "associated" || exposureMode === "total") {
			const associations = associationsRepo.findInRange(filters)
			for (const row of associations) {
				const clipped = overlapMs(
					row.startedAt,
					row.endedAt,
					bounds.start,
					bounds.end,
				)
				if (exposureMode === "total") {
					const existing = entityMap.get(`${row.entityType}:${row.entityId}`)
					if (existing !== undefined) {
						existing.totalMs += clipped
						existing.lastViewedAt = maxLastViewed(
							existing.lastViewedAt,
							row.endedAt,
						)
						continue
					}
				}
				upsertAggregate(entityMap, {
					entityType: row.entityType as UsageEntityType,
					entityId: row.entityId,
					clippedMs: clipped,
					endedAt: row.endedAt,
					viewDelta: 0,
				})
			}
		}

		const totalMs = sessions.reduce(
			(sum, session) =>
				sum +
				overlapMs(session.startedAt, session.endedAt, bounds.start, bounds.end),
			0,
		)

		const topEntities = filterRowsByExistingEntity(
			Array.from(entityMap.values()),
			db,
		)
			.sort((a, b) => b.totalMs - a.totalMs)
			.slice(0, input.limit)
			.map((entity) => ({
				id: entity.entityId,
				entityType: entity.entityType,
				entityId: entity.entityId,
				granularity: input.granularity as UsageTotalsInput["granularity"],
				period: input.period,
				totalMs: entity.totalMs,
				viewCount: entity.viewCount,
				lastViewedAt: entity.lastViewedAt,
				updatedAt: entity.lastViewedAt ?? now(),
			}))

		let hourlyMs: number[] | undefined
		let hourlyLabels: readonly string[] | undefined
		if (input.granularity === "day") {
			const { hourStarts, labels } = getDayHourBuckets(
				bounds.start,
				bounds.end,
				timeZone,
			)
			hourlyMs = Array.from({ length: hourStarts.length }, () => 0)
			for (const session of sessions) {
				const buckets = splitSessionIntoHourlyMs(
					session.startedAt,
					session.endedAt,
					bounds.start,
					bounds.end,
					timeZone,
					hourStarts,
				)
				for (let i = 0; i < buckets.length; i++) {
					hourlyMs[i] = (hourlyMs[i] ?? 0) + (buckets[i] ?? 0)
				}
			}
			hourlyMs = hourlyMs.map((ms) => Math.round(ms))
			hourlyLabels = labels
		}

		return {
			granularity: input.granularity,
			period: input.period,
			totalMs,
			sessionCount: sessions.length,
			topEntities,
			hourlyMs,
			hourlyLabels,
		}
	}

	function getEntityExposure(
		input: UsageEntityExposureInput,
	): UsageEntityExposure {
		const direct = sessionsRepo.aggregatePrimary(
			input.entityType,
			input.entityId,
		)
		const associated = associationsRepo.aggregateAssociated(
			input.entityType,
			input.entityId,
		)

		const lastViewedAt = [direct.lastViewedAt, associated.lastViewedAt]
			.filter((v): v is number => v !== null)
			.sort((a, b) => b - a)[0]

		return {
			entityType: input.entityType,
			entityId: input.entityId,
			directMs: direct.totalMs,
			associatedMs: associated.totalMs,
			totalMs: direct.totalMs + associated.totalMs,
			viewCount: direct.viewCount,
			sessionCount: direct.viewCount + associated.sessionCount,
			lastViewedAt: lastViewedAt ?? null,
		}
	}

	function clearAll(): void {
		withTransaction(db, (tx) => {
			deleteAllUsageData(tx)
		})
	}

	/** Canonical hour-of-day labels ("00:00" … "23:00"). */
	const HOURLY_LABELS = Array.from(
		{ length: 24 },
		(_, hour) => `${String(hour).padStart(2, "0")}:00`,
	)
	/**
	 * The window's hourly rhythm: per-hour totals summed across the
	 * window, divided by the number of calendar days — the "typical day"
	 * chart. Bounds are optional; all-time windows start at the earliest
	 * recorded session. One range query plus a per-session hour walk —
	 * no per-day queries, so long windows (this year, all time) stay fast.
	 */
	function getHourlyWindow(input: UsageHourlyWindowInput): UsageHourlyWindow {
		const timeZone = requireIanaTimeZone(input.timeZone)
		const ts = now()
		const to = input.to ?? ts
		let from = input.from
		if (from === undefined) {
			from =
				sessionsRepo.findEarliestStartedAt({ platform: input.platform }) ?? to
		}
		if (to <= from) {
			return {
				dayCount: 1,
				hourlyMs: Array.from({ length: 24 }, () => 0),
				hourlyLabels: HOURLY_LABELS,
			}
		}

		const sessions = sessionsRepo.findInRange({
			from,
			to,
			platform: input.platform,
		})
		const hourIndex = buildHourOfDayIndex(from, to, timeZone)
		const hourlyByHour = Array.from({ length: 24 }, () => 0)
		for (const session of sessions) {
			const buckets = splitSessionIntoHourOfDayMs(
				session.startedAt,
				session.endedAt,
				from,
				to,
				timeZone,
				hourIndex,
			)
			for (let i = 0; i < buckets.length; i++) {
				hourlyByHour[i] = (hourlyByHour[i] ?? 0) + (buckets[i] ?? 0)
			}
		}

		const startDay = dayjsFor(from, timeZone).startOf("day")
		const endDay = dayjsFor(to, timeZone).startOf("day")
		// Whole day-starts below `to`, plus the partial final day when `to`
		// lands mid-day (e.g. "now") — the calendar days the window touches.
		const dayCount = Math.max(
			1,
			endDay.diff(startDay, "day") + (to > endDay.valueOf() ? 1 : 0),
		)

		return {
			dayCount,
			hourlyMs: hourlyByHour.map((ms) => Math.round(ms / dayCount)),
			hourlyLabels: HOURLY_LABELS,
		}
	}

	return wrapAsync({
		recordSessionBeat,
		getTotals,
		getTotalsPage,
		getDashboard,
		getRecommendations,
		getTimeline,
		getDailySummary,
		getTrend,
		getPeriodSummary,
		getEntityExposure,
		getHourlyWindow,
		clearAll,
	})
}
