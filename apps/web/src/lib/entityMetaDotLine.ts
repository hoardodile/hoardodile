/**
 * Build a middle-dot-separated chip label from a list of segments.
 * Undefined segments are skipped so callers can conditionally append
 * suffixes without manual `filter`/`join` boilerplate.
 */
export function entityMetaDotLine(
	...parts: readonly (string | number | undefined)[]
): string {
	return parts
		.filter((part): part is string | number => part !== undefined)
		.join("·")
}
