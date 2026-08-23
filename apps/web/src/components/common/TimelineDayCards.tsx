import { SectionLabel } from "@hoardodile/ui/components/section-label"
import type { ReactNode } from "react"
import type { LooseTranslate } from "@/i18n"
import { dayjsFor } from "@/lib/timezone"

export type TimelineDayGroup<T> = {
	/** `YYYY-MM-DD`, or `""` for items without a timestamp. */
	readonly day: string
	readonly items: readonly T[]
}

/**
 * Group items into day buckets by a timestamp getter, preserving the
 * input order within each day (rows are already newest-first). Items
 * without a timestamp land in the `""` bucket.
 */
export function groupByTimestamp<T>(
	items: readonly T[],
	getTimestamp: (item: T) => number | null | undefined,
	timeZone: string,
): readonly TimelineDayGroup<T>[] {
	const byDay = new Map<string, T[]>()
	for (const item of items) {
		const ts = getTimestamp(item)
		const day =
			ts === null || ts === undefined
				? ""
				: dayjsFor(ts, timeZone).format("YYYY-MM-DD")
		const bucket = byDay.get(day)
		if (bucket === undefined) {
			byDay.set(day, [item])
		} else {
			bucket.push(item)
		}
	}
	return [...byDay.entries()].map(([day, dayItems]) => ({
		day,
		items: dayItems,
	}))
}

/**
 * "Today" / "Yesterday" / raw date label for a day key, using the
 * feature's own i18n keys for the friendly labels.
 */
export function dayLabel(
	day: string,
	timeZone: string,
	t: LooseTranslate,
	todayKey: string,
	yesterdayKey: string,
): string {
	const today = dayjsFor(Date.now(), timeZone).format("YYYY-MM-DD")
	if (day === today) return t(todayKey)
	const yesterday = dayjsFor(Date.now(), timeZone)
		.subtract(1, "day")
		.format("YYYY-MM-DD")
	if (day === yesterday) return t(yesterdayKey)
	return day
}

type TimelineDayCardsProps<T> = {
	readonly groups: readonly TimelineDayGroup<T>[]
	readonly dayLabel: (day: string) => string
	/** Optional stable testid per day card, e.g. `trace-day-2026-06-14`. */
	readonly dayTestId?: (day: string) => string
	/** Renders the rows of one day group inside its card. */
	readonly children: (group: TimelineDayGroup<T>) => ReactNode
}

/**
 * The day-grouped timeline card list shared by the footprints and usage
 * history pages: one quiet card per day (`rounded-xl` fill with a
 * `SectionLabel` heading), rows rendered by the caller. Rows are assumed
 * newest-first, so buckets keep their order.
 */
export function TimelineDayCards<T>(props: TimelineDayCardsProps<T>) {
	const { groups, dayLabel, dayTestId, children } = props
	return (
		<div className="flex flex-col gap-4">
			{groups.map((group) => (
				<div
					key={group.day}
					className="rounded-xl border border-border bg-card px-2 py-3"
					data-testid={dayTestId?.(group.day)}
				>
					<SectionLabel className="px-2">{dayLabel(group.day)}</SectionLabel>
					<div className="mt-1 flex flex-col">{children(group)}</div>
				</div>
			))}
		</div>
	)
}
