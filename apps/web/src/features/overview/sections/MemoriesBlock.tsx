import { MagicWand2 as MagicStick2 } from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
import { useRef } from "react"
import { useTranslation } from "react-i18next"
import { resMemoriesQueryOptions } from "@/features/res/api"
import { useResolvedTimeZone } from "@/features/settings/datePrefs"
import { dayjsFor, getCalendarMonthDay } from "@/lib/timezone"
import { MarqueeChevrons, type MarqueeHandle } from "../components/Marquee"
import { ResCardMarqueeStrip } from "../components/ResCardMarqueeStrip"
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
 *
 * The strip reuses the pinned section's {@link ResCardMarqueeStrip} (auto
 * stepping marquee + header chevrons); only the per-card years-ago caption
 * is added on top, so the date display is unchanged.
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
	const stripRef = useRef<MarqueeHandle>(null)

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
				controls={<MarqueeChevrons stripRef={stripRef} />}
			/>
			<ResCardMarqueeStrip
				rows={items}
				thumbHeightPx={MEMORIES_THUMB_HEIGHT_PX}
				stripRef={stripRef}
				captionFor={(resource) => (
					<span
						className="text-[11px] font-medium text-muted-foreground"
						data-testid="overview-memories-years-label"
					>
						{t("overview.memories.yearsAgo", {
							count: yearsAgo(resource.createdAt, resolvedTimeZone),
						})}
					</span>
				)}
			/>
		</section>
	)
}
