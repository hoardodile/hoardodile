import type { Node } from "prosemirror-model"

/** A half-open `[from, to)` range in the ProseMirror document. */
export type MatchRange = {
	readonly from: number
	readonly to: number
}

export type FindMatchesOptions = {
	/** Match the query's letter case exactly. */
	readonly caseSensitive: boolean
}

/**
 * Locate every occurrence of `query` in the document body, as ProseMirror
 * positions.
 *
 * Matches are searched per text node, so a match never spans an inline
 * content node (a `charChip` / `resCard` / `tagChip` between two words cuts
 * the match in two) — and every returned range is replaceable with a single
 * `replaceWith`. The query is matched literally (`indexOf`, never a regex),
 * so characters like `(`, `.` or `*` need no escaping. Overlapping
 * occurrences are not reported: the scan resumes after each match.
 *
 * A whitespace-only query returns no matches (nothing to look for), while
 * inner whitespace inside the query is matched literally.
 */
export function findMatches(
	doc: Node,
	query: string,
	options: FindMatchesOptions,
): MatchRange[] {
	if (query.trim().length === 0) return []
	const needle = options.caseSensitive ? query : query.toLowerCase()
	const matches: MatchRange[] = []

	doc.descendants((node, pos) => {
		if (!node.isText) return
		const text = node.text ?? ""
		if (text.length === 0) return
		const haystack = options.caseSensitive ? text : text.toLowerCase()
		let index = haystack.indexOf(needle)
		while (index !== -1) {
			const from = pos + index
			// Case folding can change a string's length (e.g. "İ"), which
			// would shift every later offset. Re-check the actual slice so a
			// drifted index is dropped instead of highlighting the wrong text.
			const found = text.slice(index, index + needle.length)
			if (options.caseSensitive || found.toLowerCase() === needle) {
				matches.push({ from, to: from + needle.length })
			}
			index = haystack.indexOf(needle, index + needle.length)
		}
	})

	return matches
}
