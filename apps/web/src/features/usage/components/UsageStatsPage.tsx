import {
	normalizeStatsSearch,
	type StatsSearch,
	type StatsSearchPatch,
} from "../lib/statsSearch"
import { StatsChartsSection } from "./StatsChartsSection"
import { StatsKpiRow } from "./StatsKpiRow"
import { StatsShareSection } from "./StatsShareSection"
import { StatsToolbar } from "./StatsToolbar"

export type UsageStatsSearch = StatsSearch

type UsageStatsPageProps = {
	readonly search: Partial<StatsSearch>
	readonly onSearchChange: (patch: StatsSearchPatch) => void
}

export function UsageStatsPage(props: UsageStatsPageProps) {
	const { search, onSearchChange } = props
	const normalized = normalizeStatsSearch(search)

	return (
		// Sections carry their own top margins (section rhythm) — the
		// wrapper never gaps them.
		<div className="flex flex-col">
			<StatsToolbar search={normalized} onSearchChange={onSearchChange} />

			<StatsKpiRow
				range={normalized.range}
				platformFilter={normalized.platform}
			/>

			<StatsChartsSection
				range={normalized.range}
				platformFilter={normalized.platform}
			/>

			<StatsShareSection
				search={normalized}
				range={normalized.range}
				platformFilter={normalized.platform}
				exposureMode={normalized.exposureMode}
				entityFilter={normalized.entityType ?? "all"}
			/>
		</div>
	)
}
