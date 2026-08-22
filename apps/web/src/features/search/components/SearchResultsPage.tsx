import { useQuery } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { SearchField } from "@/components/common/SearchField"
import { globalSearchQueryOptions, useSearchUrlState } from "@/features/search"
import { ImageSearchButton } from "./ImageSearchButton"
import { SearchEmptyState } from "./SearchEmptyState"
import { SearchImageResults } from "./SearchImageResults"
import { SearchResultSections } from "./SearchResultSections"
import { SearchSkeleton } from "./SearchSkeleton"

export function SearchResultsPage() {
	const { t } = useTranslation()
	const [state, patch] = useSearchUrlState()

	// Text search and image search are mutually exclusive URL states:
	// typing a query drops the image session and vice versa.
	const isImageSearch = state.imageSearch.length > 0

	const query = useQuery(
		globalSearchQueryOptions({
			query: isImageSearch ? "" : state.query,
			scope: "all",
			page: 1,
		}),
	)

	const hasQuery = !isImageSearch && state.query.trim().length > 0

	return (
		<div className="flex flex-col">
			<SearchField
				value={isImageSearch ? "" : state.query}
				placeholder={t("search.placeholder")}
				className="h-11 px-4"
				actions={<ImageSearchButton />}
				onSubmit={(next) => patch({ query: next.trim(), imageSearch: "" })}
			/>

			{isImageSearch ? (
				<SearchImageResults
					sessionId={state.imageSearch}
					onClear={() => patch({ imageSearch: "", query: "" })}
				/>
			) : !hasQuery ? (
				<div className="mt-8">
					<SearchEmptyState />
				</div>
			) : query.isPending ? (
				<SearchSkeleton />
			) : query.isError ? (
				<div className="rounded-lg border p-6 text-center text-sm text-muted-foreground">
					{t("common.requestFailed")}
				</div>
			) : (
				<div className="mt-8">
					<SearchResultSections data={query.data} query={state.query} />
				</div>
			)}
		</div>
	)
}
