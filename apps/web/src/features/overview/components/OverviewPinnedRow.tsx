import { PinnedCharactersSection } from "../pinned/PinnedCharactersSection"
import { PinnedResourcesSection } from "../pinned/PinnedResourcesSection"
import {
	useOverviewPinnedCharacters,
	useOverviewPinnedRefresh,
	useOverviewPinnedResources,
} from "../pinned/useOverviewPinnedData"

export function OverviewPinnedRow() {
	const charData = useOverviewPinnedCharacters()
	const resData = useOverviewPinnedResources()
	// Mounts the per-item auto-refresh schedulers (interval / midnight / mount
	// rotation); manual refresh lives on each section header.
	useOverviewPinnedRefresh()

	const showCharacters = !charData.isPending && charData.visibleItems.length > 0
	const showResources = !resData.isPending && resData.visibleItems.length > 0
	const visibleCount = Number(showCharacters) + Number(showResources)

	if (visibleCount === 0) return null

	return (
		<div
			className="flex min-w-0 flex-col gap-8"
			data-testid="overview-pinned-row"
		>
			{showResources ? (
				<div className="min-w-0">
					<PinnedResourcesSection {...resData} />
				</div>
			) : null}
			{showCharacters ? (
				<div className="min-w-0">
					<PinnedCharactersSection {...charData} />
				</div>
			) : null}
		</div>
	)
}
