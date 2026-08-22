import type { SortBy } from "@hoardodile/shared"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { useTranslation } from "react-i18next"

type SectionSortToggleProps = {
	readonly sortBy: SortBy
	readonly onChange: (sortBy: SortBy) => void
	readonly testId?: string
}

export function SectionSortToggle(props: SectionSortToggleProps) {
	const { t } = useTranslation()
	return (
		<PillTabs
			value={props.sortBy}
			onChange={props.onChange}
			items={(["created", "updated"] as const).map((value) => ({
				value,
				label: t(`overview.sort.${value}`),
				testId: props.testId ? `${props.testId}-${value}` : undefined,
			}))}
		/>
	)
}
