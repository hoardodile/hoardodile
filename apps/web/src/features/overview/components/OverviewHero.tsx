import { OverviewSearchBar } from "@/features/search/components/OverviewSearchBar"
import { TodayUsageCard } from "../sections/TodayUsageCard"
import { LibraryStatStrip } from "./LibraryStatStrip"
import { OverviewFootprintsCard } from "./OverviewFootprintsCard"
import { RecentViewedCard } from "./RecentViewedCard"

/**
 * Overview hero: the tall global search field with the stat
 * strip below on the left, and the recently-viewed + footprints + watch-time
 * cards hanging on the right. The two-region row only engages once the
 * content column can actually hold it (left min-width + rail width); below
 * that the rail wraps underneath and the left column takes the full width,
 * so the row never squeezes the search field.
 */
export function OverviewHero() {
	return (
		<header className="flex flex-col gap-8 xl:flex-row xl:flex-wrap xl:items-stretch">
			<div className="flex min-w-96 flex-1 flex-col gap-6">
				<OverviewSearchBar />
				<LibraryStatStrip />
			</div>
			<div className="flex flex-wrap items-stretch gap-6">
				<OverviewFootprintsCard />
				<RecentViewedCard />
				<TodayUsageCard variant="compact" />
			</div>
		</header>
	)
}
