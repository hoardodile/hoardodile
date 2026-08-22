import { useRouteSearchState } from "@/hooks/useRouteSearchState"

export const SEARCH_URL_DEFAULTS = {
	query: "",
	imageSearch: "",
} as const

export type SearchUrlState = {
	query: string
	/** Reverse-image-search session id (`/search?imageSearch=<id>`). */
	imageSearch: string
}

export function useSearchUrlState(): [
	SearchUrlState,
	(patch: Partial<SearchUrlState>, resetPage?: boolean) => void,
] {
	const [state, patch] =
		useRouteSearchState<SearchUrlState>(SEARCH_URL_DEFAULTS)

	function patched(patchValue: Partial<SearchUrlState>) {
		patch(patchValue)
	}

	return [state, patched]
}
