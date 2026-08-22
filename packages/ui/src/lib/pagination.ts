/**
 * Compute the number of pages for a paginated list given a total row count
 * and the page size. Always at least 1 so the UI never renders "1 / 0".
 */
export function pageCountOf(total: number, pageSize: number): number {
	return Math.max(1, Math.ceil(total / pageSize))
}

/**
 * The page numbers a windowed pager renders: the first and last pages are
 * always shown, with an asymmetric window around the active one (more
 * pages trailing than leading) and an ellipsis wherever the gap between
 * two segments is wider than a single page (adjacent numbers render
 * directly, no ellipsis).
 *
 * @example
 *   paginationWindow(6, 68) // [1, "…", 5, 6, 7, 8, "…", 68]
 *   paginationWindow(1, 5)  // [1, 2, 3, 4, 5]
 */
export function paginationWindow(
	page: number,
	pageCount: number,
	before = 1,
	after = 2,
): readonly (number | "…")[] {
	const windowStart = Math.max(2, page - before)
	const windowEnd = Math.min(pageCount - 1, page + after)
	const items: (number | "…")[] = [1]
	if (windowStart > 2) {
		items.push("…")
	}
	for (let p = windowStart; p <= windowEnd; p++) {
		items.push(p)
	}
	if (windowEnd < pageCount - 1) {
		items.push("…")
	}
	if (pageCount > 1) {
		items.push(pageCount)
	}
	return items
}
