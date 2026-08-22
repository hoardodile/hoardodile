import type { SimilarFileMatch } from "@hoardodile/schemas"
import { SectionHeader } from "@hoardodile/ui/components/section-header"
import { useQuery } from "@tanstack/react-query"
import type { ReactNode } from "react"
import { useTranslation } from "react-i18next"
import { bestMatchSimilarity } from "@/features/res/components/MatchThumbStrip"
import { ResCard as ResourceCard } from "@/features/res/components/ResCard"
import { imageSearchQueryOptions } from "@/features/search"
import { apiPaths } from "@/lib/paths"
import { ImageSearchResultsSkeleton } from "./ImageSearchResultsSkeleton"

/**
 * Results view for a reverse-image-search session: the query image
 * (served by the session endpoint) plus a grid of the resources whose
 * images are perceptually similar to it, ranked by best Hamming
 * distance.
 */
export function SearchImageResults(props: {
	readonly sessionId: string
	readonly onClear: () => void
}) {
	const { sessionId, onClear } = props
	const { t } = useTranslation()
	const query = useQuery(imageSearchQueryOptions(sessionId))

	if (query.isPending) {
		return <ImageSearchResultsSkeleton />
	}
	if (query.isError) {
		return (
			<div className="mt-8 flex flex-col items-center gap-3 rounded-lg border p-6 text-center text-sm text-muted-foreground">
				<p>{t("common.requestFailed")}</p>
				<button
					type="button"
					onClick={onClear}
					className="cursor-pointer text-xs text-muted-foreground underline-offset-2 hover:underline"
				>
					{t("search.imageSearch.clear")}
				</button>
			</div>
		)
	}

	const results = query.data.results
	return (
		<div className="mt-8 flex flex-col gap-8">
			<section className="flex flex-col gap-4">
				<SectionHeader
					title={t("search.imageSearch.title")}
					count={t("search.sectionCount", { count: results.length })}
					right={
						<button
							type="button"
							data-testid="image-search-clear"
							onClick={onClear}
							className="cursor-pointer text-xs text-muted-foreground hover:text-secondary-foreground"
						>
							{t("search.imageSearch.clear")}
						</button>
					}
				/>
				<div className="flex items-center gap-3">
					<img
						src={apiPaths.imageSearch.queryImage(sessionId)}
						alt={t("search.imageSearch.queryAlt")}
						className="size-16 shrink-0 rounded-lg object-cover"
						data-testid="image-search-query-image"
					/>
					{results.length === 0 ? (
						<p className="text-sm text-muted-foreground">
							{t("search.imageSearch.empty")}
						</p>
					) : null}
				</div>
			</section>
			{results.length > 0 ? (
				<ul className="flex flex-wrap justify-around gap-6">
					{results.map((entry) => (
						<li key={entry.resource.id}>
							<ResourceCard
								resource={entry.resource}
								metaLeft={similarityLine(entry.files)}
							/>
						</li>
					))}
				</ul>
			) : null}
		</div>
	)

	function similarityLine(files: readonly SimilarFileMatch[]): ReactNode {
		const percent = bestMatchSimilarity(files)
		if (percent === undefined) return null
		return (
			<span data-testid="image-search-similarity">
				{t("search.imageSearch.similarity", { percent })}
			</span>
		)
	}
}
