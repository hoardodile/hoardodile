import { keepPreviousData } from "@tanstack/react-query"
import type { RouterInputs } from "@/trpc/client"
import { trpcMutation, trpcQueryOptions } from "@/trpc/factory"

export type TraceTimelineInput = RouterInputs["trace"]["timeline"]

export type TraceReportInput = RouterInputs["trace"]["report"]

export const traceKeys = {
	all: ["trace"] as const,
	timeline: (input: TraceTimelineInput) =>
		[...traceKeys.all, "timeline", input] as const,
	report: (input: TraceReportInput) =>
		[...traceKeys.all, "report", input] as const,
} as const

export function traceTimelineQueryOptions(input: TraceTimelineInput) {
	return trpcQueryOptions({
		namespace: "trace",
		procedure: "timeline",
		input,
		queryKey: traceKeys.timeline(input),
		staleTime: 5_000,
		// Keep the current page visible while flipping pages.
		placeholderData: keepPreviousData,
	})
}

export function traceReportQueryOptions(input: TraceReportInput) {
	return trpcQueryOptions({
		namespace: "trace",
		procedure: "report",
		input,
		queryKey: traceKeys.report(input),
		staleTime: 60_000,
	})
}

export function clearAllTraceMutation() {
	return trpcMutation("trace", "clearAll", {
		transform: () => undefined,
	})
}
