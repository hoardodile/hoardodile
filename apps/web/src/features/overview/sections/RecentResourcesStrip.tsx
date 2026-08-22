import type { SortBy } from "@hoardodile/shared"
import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { resListCardsQueryOptions } from "@/features/res/api"
import { ResCardMarqueeStrip } from "../components/ResCardMarqueeStrip"

const RECENT_RESOURCES_SIZE = 8
const THUMB_HEIGHT_PX = 240

/**
 * How many resources the recent-resources tab currently displays, fetched
 * through the tab's own query options so both share one cache entry.
 */
export function useRecentResourcesCount(sortBy: SortBy): number | undefined {
	const { data } = useQuery(
		resListCardsQueryOptions({
			query: "",
			page: 1,
			size: RECENT_RESOURCES_SIZE,
			sortBy,
			order: "desc",
		}),
	)
	return data?.rows.length
}

/**
 * Recent-activity resources tab: the same card strip as the
 * pinned row — covers carry recollection better than rows. Auto-steps via
 * the marquee; the section header's pill tabs own the sort.
 */
export function RecentResourcesStrip({ sortBy }: { readonly sortBy: SortBy }) {
	const { t } = useTranslation()
	const { data, isPending } = useQuery(
		resListCardsQueryOptions({
			query: "",
			page: 1,
			size: RECENT_RESOURCES_SIZE,
			sortBy,
			order: "desc",
		}),
	)

	return (
		<ResCardMarqueeStrip
			rows={data?.rows ?? []}
			isPending={isPending || data === undefined}
			emptyLabel={t("overview.empty.resources")}
			thumbHeightPx={THUMB_HEIGHT_PX}
			skeletonCount={RECENT_RESOURCES_SIZE}
			testId="overview-activity-resources"
		/>
	)
}
