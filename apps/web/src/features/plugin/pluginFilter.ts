/**
 * Plugin list filter — case-insensitive match against the display name,
 * description and id. The panel resolves localized strings before
 * calling, so this stays a pure predicate.
 */
export function matchesPluginQuery(
	fields: {
		readonly id: string
		readonly name: string
		readonly description: string
	},
	query: string,
): boolean {
	const q = query.trim().toLowerCase()
	if (q.length === 0) return true
	return (
		fields.id.toLowerCase().includes(q) ||
		fields.name.toLowerCase().includes(q) ||
		fields.description.toLowerCase().includes(q)
	)
}
