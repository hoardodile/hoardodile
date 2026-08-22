import { MagicWand2 as MagicStick2 } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { resMemoriesQueryOptions } from "@/features/res/api"
import { ResCard } from "@/features/res/components/ResCard"
import { useResolvedTimeZone } from "@/features/settings/datePrefs"
import { dayjsFor, getCalendarMonthDay } from "@/lib/timezone"
import { SectionTitle } from "../components/SectionTitle"

/** Uniform thumbnail height matching the pinned strip's rhythm. */
const MEMORIES_THUMB_HEIGHT_PX = 240

function yearsAgo(createdAt: number, timeZone: string): number {
	return (
		dayjsFor(Date.now(), timeZone).year() - dayjsFor(createdAt, timeZone).year()
	)
}

/**
 * "On this day" dashboard section: resources created on today's month-day
 * in previous years, newest year first, each captioned with how long ago
 * they were hoarded. Renders nothing when there are no memories today, so
 * a fresh archive stays uncluttered.
 */
export function MemoriesBlock() {
	const { t } = useTranslation()
	const resolvedTimeZone = useResolvedTimeZone()
	const now = Date.now()
	const { month, day } = getCalendarMonthDay(now, resolvedTimeZone)
	const offsetMin = dayjsFor(now, resolvedTimeZone).utcOffset()
	const memoriesQuery = useQuery(
		resMemoriesQueryOptions({ month, day, offsetMin }),
	)
	const items = memoriesQuery.data ?? []

	if (memoriesQuery.isPending || items.length === 0) return null

	return (
		<section
			className="flex flex-col gap-4"
			data-testid="overview-memories-block"
		>
			<SectionTitle
				icon={MagicStick2}
				title={
					<h2 className="text-base font-semibold">
						{t("overview.memories.title")}
					</h2>
				}
				count={items.length}
			/>
			<div className="flex w-fit max-w-full gap-6 no-scrollbar overflow-x-auto pb-2">
				{items.map((resource) => (
					<div key={resource.id} className="flex shrink-0 flex-col gap-2">
						<span
							className="text-[11px] font-medium text-muted-foreground"
							data-testid="overview-memories-years-label"
						>
							{t("overview.memories.yearsAgo", {
								count: yearsAgo(resource.createdAt, resolvedTimeZone),
							})}
						</span>
						<ResCard
							resource={resource}
							thumbFitHeight={MEMORIES_THUMB_HEIGHT_PX}
						/>
					</div>
				))}
			</div>
		</section>
	)
}
