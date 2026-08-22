import { MAX_SEARCH_QUERY_LENGTH } from "@hoardodile/schemas"
import {
	SearchField as SearchFieldShell,
	type SearchFieldProps as SearchFieldShellProps,
} from "@hoardodile/ui/components/search-field"

export type SearchFieldProps = Omit<SearchFieldShellProps, "maxLength">

/**
 * The app-wired {@link SearchField} shell: the search-query length cap
 * lives here, everything else passes through to
 * `@hoardodile/ui/components/search-field`.
 */
export function SearchField(props: SearchFieldProps) {
	return <SearchFieldShell {...props} maxLength={MAX_SEARCH_QUERY_LENGTH} />
}
