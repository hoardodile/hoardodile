import type {
	ClientPlatform,
	UsageDailySummaryInput,
	UsageEntityExposureInput,
	UsageEntityType,
	UsageHourlyWindowInput,
	UsageRecommendationKind,
	UsageTimelineInput,
	UsageTotalsInput,
	UsageTrendInput,
} from "@hoardodile/schemas"
import { queryOptions } from "@tanstack/react-query"
import { DEFAULT_TIME_ZONE } from "@/features/settings/datePrefs"
import { getRangeBounds, type UsageRange } from "@/features/usage/lib/date"
import { resolveBrowserTimeZone } from "@/lib/timezone"
import { trpcMutation, trpcQuery, trpcQueryOptions } from "@/trpc/factory"

type WithOptionalTimeZone = {
	readonly timeZone?: string
}

type UsageTotalsBoundedInput = Extract<
	UsageTotalsInput,
	{ granularity: "day" | "week" | "month" | "year" }
>

type UsageTotalsQueryInput = WithOptionalTimeZone &
	(
		| Extract<UsageTotalsInput, { granularity: "all" }>
		| (Omit<UsageTotalsBoundedInput, "timeZone"> & WithOptionalTimeZone)
	)

type UsageDailySummaryQueryInput = Omit<UsageDailySummaryInput, "timeZone"> &
	WithOptionalTimeZone

type UsageTrendQueryInput = Omit<UsageTrendInput, "timeZone"> &
	WithOptionalTimeZone

function withResolvedUsageTimeZone<T extends WithOptionalTimeZone>(
	input: T,
): T & { timeZone: string } {
	const tz = input.timeZone ?? DEFAULT_TIME_ZONE
	return { ...input, timeZone: resolveBrowserTimeZone(tz) }
}

export const usageKeys = {
	all: ["usage"] as const,
	totals: (input: UsageTotalsInput) =>
		[...usageKeys.all, "totals", input] as const,
	totalsPage: (input: UsageTotalsInput) =>
		[...usageKeys.all, "totalsPage", input] as const,
	dashboard: (input?: { platform?: ClientPlatform }) =>
		[...usageKeys.all, "dashboard", input] as const,
	recommendations: (kind: UsageRecommendationKind, timeZone?: string) =>
		[...usageKeys.all, "recommendations", kind, timeZone] as const,
	timeline: (input: UsageTimelineInput) =>
		[...usageKeys.all, "timeline", input] as const,
	dailySummary: (input: UsageDailySummaryInput) =>
		[...usageKeys.all, "dailySummary", input] as const,
	hourlyWindow: (input: UsageHourlyWindowInput) =>
		[...usageKeys.all, "hourlyWindow", input] as const,
	trend: (input: UsageTrendInput) =>
		[...usageKeys.all, "trend", input] as const,
	entityExposure: (input: UsageEntityExposureInput) =>
		[...usageKeys.all, "entityExposure", input] as const,
} as const

export function usageTotalsQueryOptions(input: UsageTotalsQueryInput) {
	const resolved = withResolvedUsageTimeZone(input) as UsageTotalsInput
	return trpcQueryOptions({
		namespace: "usage",
		procedure: "listTotals",
		input: resolved,
		queryKey: usageKeys.totals(resolved),
		staleTime: 5_000,
	})
}

export function usageTotalsPageQueryOptions(input: UsageTotalsQueryInput) {
	const resolved = withResolvedUsageTimeZone(input) as UsageTotalsInput
	return trpcQueryOptions({
		namespace: "usage",
		procedure: "totalsPage",
		input: resolved,
		queryKey: usageKeys.totalsPage(resolved),
		staleTime: 5_000,
	})
}

export function usageDashboardQueryOptions(input?: {
	platform?: ClientPlatform
}) {
	return queryOptions({
		queryKey: usageKeys.dashboard(input),
		queryFn: () => trpcQuery("usage", "dashboard", input ?? {}),
		staleTime: 5_000,
	})
}

export function usageRecommendationsQueryOptions(
	kind: UsageRecommendationKind,
	timeZone?: string,
) {
	const resolvedTimeZone = resolveBrowserTimeZone(timeZone ?? DEFAULT_TIME_ZONE)
	return queryOptions({
		queryKey: usageKeys.recommendations(kind, resolvedTimeZone),
		queryFn: () =>
			trpcQuery("usage", "recommendations", {
				kind,
				limit: 10,
				timeZone: resolvedTimeZone,
			}),
		staleTime: 60_000,
	})
}

export function clearAllUsageMutation() {
	return trpcMutation("usage", "clearAll", {
		transform: () => undefined,
	})
}

export function recordUsageSessionBeatMutation() {
	return trpcMutation("usage", "recordSessionBeat", {
		transform: (input: {
			readonly sessionId: string
			readonly entityType: UsageEntityType
			readonly entityId: string
			readonly startedAt: number
			readonly durationMs: number
			readonly platform?: ClientPlatform
		}) => input,
	})
}

export function usageTimelineQueryOptions(input: UsageTimelineInput) {
	return queryOptions({
		queryKey: usageKeys.timeline(input),
		queryFn: () => trpcQuery("usage", "timeline", input),
		staleTime: 5_000,
	})
}

type UsageTimelineForRangeInput = Omit<UsageTimelineInput, "from" | "to"> & {
	readonly range: UsageRange
	readonly timeZone?: string
}

/** Timeline query with range bounds derived from the user's time-zone pref. */
export function usageTimelineForRangeQueryOptions(
	input: UsageTimelineForRangeInput,
) {
	const timeZonePref = input.timeZone ?? DEFAULT_TIME_ZONE
	const bounds = getRangeBounds(input.range, timeZonePref)
	const { range: _range, timeZone: _timeZone, ...rest } = input
	const timelineInput: UsageTimelineInput = {
		...rest,
		...(bounds !== undefined ? { from: bounds.from, to: bounds.to } : {}),
	}
	return usageTimelineQueryOptions(timelineInput)
}

export function usageDailySummaryQueryOptions(
	input: UsageDailySummaryQueryInput,
) {
	const resolved = withResolvedUsageTimeZone(input) as UsageDailySummaryInput
	return queryOptions({
		queryKey: usageKeys.dailySummary(resolved),
		queryFn: () => trpcQuery("usage", "dailySummary", resolved),
		staleTime: 5_000,
	})
}

type UsageHourlyWindowQueryInput = Omit<UsageHourlyWindowInput, "timeZone"> &
	WithOptionalTimeZone

/** The daily rhythm of a window — per-hour totals averaged per day. */
export function usageHourlyWindowQueryOptions(
	input: UsageHourlyWindowQueryInput,
) {
	const resolved = withResolvedUsageTimeZone(input) as UsageHourlyWindowInput
	return trpcQueryOptions({
		namespace: "usage",
		procedure: "hourlyWindow",
		input: resolved,
		queryKey: usageKeys.hourlyWindow(resolved),
		staleTime: 60_000,
	})
}

export function usageTrendQueryOptions(input: UsageTrendQueryInput) {
	const resolved = withResolvedUsageTimeZone(input) as UsageTrendInput
	return queryOptions({
		queryKey: usageKeys.trend(resolved),
		queryFn: () => trpcQuery("usage", "trend", resolved),
		staleTime: 60_000,
	})
}

export function usageEntityExposureQueryOptions(
	input: UsageEntityExposureInput,
) {
	return queryOptions({
		queryKey: usageKeys.entityExposure(input),
		queryFn: () => trpcQuery("usage", "entityExposure", input),
		staleTime: 60_000,
	})
}
