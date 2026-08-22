/**
 * Entity filter — case-insensitive match against the display name.
 * Shared by the custom-page panels' toolbar filter field.
 */
export function matchesNameQuery(name: string, query: string): boolean {
	const q = query.trim().toLowerCase()
	if (q.length === 0) return true
	return name.toLowerCase().includes(q)
}
