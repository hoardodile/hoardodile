import { RecentCharactersSection } from "../sections/RecentCharactersSection"
import { RecentCommentsSection } from "../sections/RecentCommentsSection"
import { RecentDocumentsSection } from "../sections/RecentDocumentsSection"
import { RecentResourcesSection } from "../sections/RecentResourcesSection"

const sections = [
	{ key: "resources", element: <RecentResourcesSection /> },
	{ key: "characters", element: <RecentCharactersSection /> },
	{ key: "documents", element: <RecentDocumentsSection mode="summary" /> },
	{ key: "comments", element: <RecentCommentsSection mode="summary" /> },
]

export function LibraryStatStrip() {
	return (
		<div
			className="flex flex-wrap gap-x-8 gap-y-4 sm:gap-x-12"
			data-testid="overview-library-stat-strip"
		>
			{sections.map(({ key, element }) => (
				<div key={key}>{element}</div>
			))}
		</div>
	)
}
