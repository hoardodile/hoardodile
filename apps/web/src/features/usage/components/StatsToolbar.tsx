import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import { useTranslation } from "react-i18next"
import type { UsageRange } from "../lib/date"
import type { StatsSearch, StatsSearchPatch } from "../lib/statsSearch"

const RANGES: { value: UsageRange; labelKey: string }[] = [
	{ value: "today", labelKey: "usage.periods.today" },
	{ value: "last7days", labelKey: "usage.periods.last7days" },
	{ value: "thisWeek", labelKey: "usage.periods.thisWeek" },
	{ value: "thisMonth", labelKey: "usage.periods.thisMonth" },
	{ value: "thisYear", labelKey: "usage.periods.thisYear" },
	{ value: "all", labelKey: "usage.periods.all" },
]

type StatsToolbarProps = {
	readonly search: StatsSearch
	readonly onSearchChange: (patch: StatsSearchPatch) => void
}

export function StatsToolbar(props: StatsToolbarProps) {
	const { search, onSearchChange } = props
	const { t } = useTranslation()

	return (
		<SectionTabs
			value={search.range}
			onChange={(value) => {
				onSearchChange({ range: value })
			}}
			items={RANGES.map((range) => ({
				value: range.value,
				label: t(range.labelKey),
			}))}
		/>
	)
}
