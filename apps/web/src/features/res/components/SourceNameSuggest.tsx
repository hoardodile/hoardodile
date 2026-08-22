import { useQuery } from "@tanstack/react-query"
import { resSourceNamesQueryOptions } from "../api"

/**
 * Fixed id shared by every source-name input's `list` attribute and this
 * datalist. Only one resource form renders at a time (edit dialog vs. the
 * create page never mount together), so a single id is safe.
 */
export const SOURCE_NAME_DATALIST_ID = "res-source-name-options"

/**
 * `<datalist>` of previously used source names (most used first). Attach
 * via `list={SOURCE_NAME_DATALIST_ID}` on a source-name input so users
 * pick from existing labels instead of retyping near-duplicates.
 */
export function SourceNameSuggest() {
	const sourceNamesQuery = useQuery(resSourceNamesQueryOptions())
	const names = (sourceNamesQuery.data ?? []).map(({ name }) => name)
	if (names.length === 0) return null
	return (
		<datalist
			id={SOURCE_NAME_DATALIST_ID}
			data-testid={SOURCE_NAME_DATALIST_ID}
		>
			{names.map((name) => (
				<option key={name} value={name} />
			))}
		</datalist>
	)
}
