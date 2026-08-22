import { z } from "zod"
import { charCard } from "./char.ts"
import { clientPlatform } from "./platform.ts"
import { id } from "./primitives.ts"
import { resCard } from "./res.ts"
import { isValidIanaTimeZone, LOCAL_TIME_ZONE_SENTINEL } from "./timezone.ts"

/**
 * Kinds of entities that can accumulate usage time.
 *
 * - `resource` — an uploaded resource (video, document, ...).
 * - `character` — a character. Time is inherited from linked resources/documents.
 * - `document` — a knowledge-base document.
 * - `plugin` — a content plugin id, aggregated from resources owned by that plugin.
 */
export const usageEntityType = z.enum([
	"resource",
	"character",
	"document",
	"plugin",
])
export type UsageEntityType = z.infer<typeof usageEntityType>

/**
 * Aggregation granularity.
 *
 * - `all` — cumulative totals since tracking began.
 * - `day` — totals for a single calendar day (`period` is `YYYY-MM-DD`).
 */
export const usageGranularity = z.enum(["all", "day", "week", "month", "year"])
export type UsageGranularity = z.infer<typeof usageGranularity>

/** Granularity for trend/period reports (excludes `all`). */
export const usageReportGranularity = z.enum(["day", "week", "month", "year"])
export type UsageReportGranularity = z.infer<typeof usageReportGranularity>

/**
 * How entity-level usage time is counted in rankings and breakdowns.
 *
 * - `direct` — primary sessions only (entity was the main focus).
 * - `associated` — exposure through linked sessions only.
 * - `total` — direct plus associated time.
 */
export const usageExposureMode = z.enum(["direct", "associated", "total"])
export type UsageExposureMode = z.infer<typeof usageExposureMode>

/** IANA zone for usage period boundaries; `"local"` must be resolved client-side. */
export const requiredUsageTimeZone = z
	.string()
	.refine((tz) => tz !== LOCAL_TIME_ZONE_SENTINEL && tz.length > 0, {
		message: "timeZone must be a resolved IANA zone",
	})
	.refine(isValidIanaTimeZone, {
		message: "timeZone must be a valid IANA zone",
	})

/** Optional resolved IANA zone (e.g. when granularity is `all`). */
export const resolvedUsageTimeZone = requiredUsageTimeZone.optional()

const usageTotalsOrder = z.enum(["time", "recent", "views"]).default("time")
const usageTotalsLimit = z.number().int().positive().max(100).default(10)
const usageTotalsPageNumber = z.number().int().positive().optional()
const usageQueryFilters = {
	platform: clientPlatform.optional(),
	exposureMode: usageExposureMode.optional(),
}

/**
 * A heartbeat that updates an active viewing session.
 *
 * The client owns a `sessionId` for the duration of a continuous view. Each
 * beat extends the session's `endedAt` and `durationMs`. Related entities are
 * attached server-side via `usage_session_associations`.
 */
export const usageSessionBeatInput = z.object({
	sessionId: id,
	entityType: usageEntityType,
	entityId: id,
	/** Session start timestamp. Used to detect a restarted/stale session. */
	startedAt: z.number().int().nonnegative(),
	/** Current cumulative duration of the session, in milliseconds. */
	durationMs: z.number().int().nonnegative(),
	/** Platform the heartbeat was sent from. */
	platform: clientPlatform.optional(),
})
export type UsageSessionBeatInput = z.infer<typeof usageSessionBeatInput>

/**
 * Query for top-N usage totals. Ranges that do not map to a single
 * period (e.g. the stats page's last-7-days) pass explicit `from`/`to`
 * epoch bounds instead; the server clips sessions to the window the same
 * way period bounds do.
 */
export const usageTotalsInput = z.union([
	z.object({
		entityType: usageEntityType,
		granularity: z.literal("all").default("all"),
		period: z.string().optional(),
		from: z.number().int().nonnegative().optional(),
		to: z.number().int().nonnegative().optional(),
		order: usageTotalsOrder,
		limit: usageTotalsLimit,
		page: usageTotalsPageNumber,
		timeZone: resolvedUsageTimeZone,
		...usageQueryFilters,
	}),
	z.object({
		entityType: usageEntityType,
		granularity: z.enum(["day", "week", "month", "year"]),
		period: z.string().min(1),
		from: z.number().int().nonnegative().optional(),
		to: z.number().int().nonnegative().optional(),
		order: usageTotalsOrder,
		limit: usageTotalsLimit,
		page: usageTotalsPageNumber,
		timeZone: requiredUsageTimeZone,
		...usageQueryFilters,
	}),
])
export type UsageTotalsInput = z.infer<typeof usageTotalsInput>

/**
 * A single usage total row exposed to clients.
 */
export const usageTotal = z.object({
	id,
	entityType: usageEntityType,
	entityId: id,
	granularity: usageGranularity,
	period: z.string().nullable(),
	totalMs: z.number().int().nonnegative(),
	viewCount: z.number().int().nonnegative(),
	lastViewedAt: z.number().int().nonnegative().nullable(),
	updatedAt: z.number().int().nonnegative(),
})
export type UsageTotal = z.infer<typeof usageTotal>

/**
 * Paged usage totals returned by `usage.totalsPage`.
 */
export const usageTotalsPage = z.object({
	rows: z.array(usageTotal),
	total: z.number().int().nonnegative(),
	page: z.number().int().positive(),
	size: z.number().int().positive(),
})
export type UsageTotalsPage = z.infer<typeof usageTotalsPage>

/**
 * Dashboard bundle returned by `usage.dashboard`.
 */
export const usageDashboard = z.object({
	totalMs: z.number().int().nonnegative(),
	totalViews: z.number().int().nonnegative(),
	topResources: z.array(usageTotal).readonly(),
	topCharacters: z.array(usageTotal).readonly(),
	topDocuments: z.array(usageTotal).readonly(),
	topPlugins: z.array(usageTotal).readonly(),
	recentActivity: z.array(usageTotal).readonly(),
})
export type UsageDashboard = z.infer<typeof usageDashboard>

/**
 * Recommendation categories surfaced on the overview page.
 *
 * - `continue` — resources and documents the user viewed recently but
 *   haven't finished, ordered by recency.
 * - `topPicks` — resources and characters with the highest time-weighted
 *   score, biased toward recently viewed items.
 */
export const usageRecommendationKind = z.enum(["continue", "topPicks"])
export type UsageRecommendationKind = z.infer<typeof usageRecommendationKind>

/**
 * A single recommendation row, with the entity card attached when
 * available. The card shape matches the existing `resource.detailCard` /
 * `character.detailCard` responses so the homepage can render the same
 * card components without extra queries.
 */
export const usageRecommendation = z.object({
	entityType: usageEntityType,
	entityId: id,
	totalMs: z.number().int().nonnegative(),
	lastViewedAt: z.number().int().nonnegative().nullable(),
	resource: resCard.nullable().optional(),
	character: charCard.nullable().optional(),
	document: z
		.object({ id, title: z.string().min(1) })
		.nullable()
		.optional(),
})
export type UsageRecommendation = z.infer<typeof usageRecommendation>

/**
 * Input for `usage.recommendations`.
 */
export const usageRecommendationsInput = z.object({
	kind: usageRecommendationKind,
	limit: z.number().int().positive().max(50).default(10),
	timeZone: requiredUsageTimeZone,
})
export type UsageRecommendationsInput = z.infer<
	typeof usageRecommendationsInput
>

/**
 * A single association attached to a viewing session.
 */
/**
 * A single association attached to a viewing session.
 */
export const usageSessionAssociation = z.object({
	sessionId: id,
	entityType: usageEntityType,
	entityId: id,
	associationKind: z.enum(["owner", "linked", "contained"]),
})

/**
 * A single session entry returned by the timeline.
 */
export const usageTimelineItem = z.object({
	sessionId: id,
	entityType: usageEntityType,
	entityId: id,
	startedAt: z.number().int().nonnegative(),
	endedAt: z.number().int().nonnegative(),
	durationMs: z.number().int().nonnegative(),
	platform: clientPlatform.nullable(),
	associations: z.array(usageSessionAssociation).readonly(),
})
export type UsageTimelineItem = z.infer<typeof usageTimelineItem>

/**
 * Input for `usage.timeline`.
 */
export const usageTimelineInput = z.object({
	entityType: usageEntityType.optional(),
	entityId: id.optional(),
	from: z.number().int().nonnegative().optional(),
	to: z.number().int().nonnegative().optional(),
	limit: z.number().int().positive().max(200).default(50),
	/** Optional platform filter. */
	platform: clientPlatform.optional(),
})
export type UsageTimelineInput = z.infer<typeof usageTimelineInput>

/**
 * A daily summary returned by `usage.dailySummary`.
 */
export const usageDailySummary = z.object({
	date: z.string().min(1),
	totalMs: z.number().int().nonnegative(),
	sessionCount: z.number().int().nonnegative(),
	hourlyMs: z.array(z.number().int().nonnegative()).readonly(),
	hourlyLabels: z.array(z.string().min(1)).readonly(),
	topEntities: z.array(usageTotal).readonly(),
})
export type UsageDailySummary = z.infer<typeof usageDailySummary>

/**
 * Input for `usage.dailySummary`.
 */
export const usageDailySummaryInput = z.object({
	date: z.string().min(1),
	limit: z.number().int().positive().max(100).default(10),
	/** Time zone used to compute day/hour boundaries. */
	timeZone: requiredUsageTimeZone,
	platform: clientPlatform.optional(),
})
export type UsageDailySummaryInput = z.infer<typeof usageDailySummaryInput>

/**
 * Input for `usage.hourlyWindow` — the daily rhythm of a multi-day
 * window. Bounds are optional (all-time starts at the earliest session);
 * the response's `hourlyMs` is the per-hour total divided by the number
 * of calendar days the window spans.
 */
export const usageHourlyWindowInput = z.object({
	from: z.number().int().nonnegative().optional(),
	to: z.number().int().nonnegative().optional(),
	timeZone: requiredUsageTimeZone,
	platform: clientPlatform.optional(),
})
export type UsageHourlyWindowInput = z.infer<typeof usageHourlyWindowInput>

/**
 * Hour-of-day distribution over a window, averaged per calendar day.
 */
export const usageHourlyWindow = z.object({
	/** Calendar days spanned by the window (the average's divisor). */
	dayCount: z.number().int().positive(),
	hourlyMs: z.array(z.number().int().nonnegative()).readonly(),
	hourlyLabels: z.array(z.string().min(1)).readonly(),
})
export type UsageHourlyWindow = z.infer<typeof usageHourlyWindow>

/**
 * A single bucket in a trend report.
 */
export const usageTrendBucket = z.object({
	period: z.string().min(1),
	totalMs: z.number().int().nonnegative(),
	sessionCount: z.number().int().nonnegative(),
})

/**
 * Input for `usage.trend`.
 */
export const usageTrendInput = z.object({
	granularity: usageReportGranularity,
	/** Number of periods to look back from now. */
	periods: z.number().int().positive().max(366).default(7),
	entityType: usageEntityType.optional(),
	platform: clientPlatform.optional(),
	timeZone: requiredUsageTimeZone,
})
export type UsageTrendInput = z.infer<typeof usageTrendInput>

/**
 * Output for `usage.trend`.
 */
export const usageTrend = z.object({
	granularity: usageReportGranularity,
	buckets: z.array(usageTrendBucket).readonly(),
})
export type UsageTrend = z.infer<typeof usageTrend>

/**
 * Input for `usage.periodSummary`.
 */
export const usagePeriodSummaryInput = z.object({
	granularity: usageReportGranularity,
	period: z.string().min(1),
	limit: z.number().int().positive().max(100).default(10),
	platform: clientPlatform.optional(),
	timeZone: requiredUsageTimeZone,
	exposureMode: usageExposureMode.optional(),
})
export type UsagePeriodSummaryInput = z.infer<typeof usagePeriodSummaryInput>

/**
 * Summary for a single period (day/week/month/year).
 */
export const usagePeriodSummary = z.object({
	granularity: usageReportGranularity,
	period: z.string().min(1),
	totalMs: z.number().int().nonnegative(),
	sessionCount: z.number().int().nonnegative(),
	topEntities: z.array(usageTotal).readonly(),
	hourlyMs: z.array(z.number().int().nonnegative()).readonly().optional(),
	hourlyLabels: z.array(z.string().min(1)).readonly().optional(),
})
export type UsagePeriodSummary = z.infer<typeof usagePeriodSummary>

/**
 * Exposure breakdown for a single entity.
 */
export const usageEntityExposure = z.object({
	entityType: usageEntityType,
	entityId: id,
	directMs: z.number().int().nonnegative(),
	associatedMs: z.number().int().nonnegative(),
	totalMs: z.number().int().nonnegative(),
	/** Times the entity was directly opened (primary usage sessions). */
	viewCount: z.number().int().nonnegative(),
	/**
	 * Direct plus associated session count. Entity detail UI should use
	 * `viewCount` instead; kept for backward compatibility.
	 */
	sessionCount: z.number().int().nonnegative(),
	lastViewedAt: z.number().int().nonnegative().nullable(),
})
export type UsageEntityExposure = z.infer<typeof usageEntityExposure>

/**
 * Input for `usage.entityExposure`.
 */
export const usageEntityExposureInput = z.object({
	entityType: usageEntityType,
	entityId: id,
})
export type UsageEntityExposureInput = z.infer<typeof usageEntityExposureInput>
