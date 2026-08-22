import { SyncReminderBanner } from "@/features/sync/SyncReminderBanner"
import { OverviewActivityPanel } from "./components/OverviewActivityPanel"
import { OverviewHero } from "./components/OverviewHero"
import { OverviewPinnedRow } from "./components/OverviewPinnedRow"
import { MemoriesBlock } from "./sections/MemoriesBlock"

/**
 * Overview dashboard layout: a single centered wide column (1200px slot)
 * stacking hero → pinned → memories → recent activity with 32px
 * section gaps. Each section owns its state, query, and loading skeleton so
 * sorting or tab changes in one area do not re-render the rest. Sections are
 * separated by whitespace instead of nested card surfaces.
 */
export function OverviewDashboard() {
	return (
		<div className="flex w-full flex-col gap-8">
			<SyncReminderBanner />
			<OverviewHero />
			<OverviewPinnedRow />
			<MemoriesBlock />
			<OverviewActivityPanel />
		</div>
	)
}
