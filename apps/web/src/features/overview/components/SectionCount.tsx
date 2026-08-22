/**
 * Quiet count next to a section title — plain gray tiny text, the same
 * anatomy as sidebar counts (`text-tiny text-muted-foreground tabular-nums`).
 * Shows how many items the section currently displays. Renders nothing
 * until a count is available. In zh the title's CJK glyphs fill their em
 * box (baseline sits low), so the baseline-aligned digits read 1px low —
 * nudge them up under `html:lang(zh)`.
 */
export function SectionCount({
	count,
}: {
	readonly count: number | undefined
}) {
	if (count === undefined) return null
	return (
		<span className="shrink-0 text-tiny text-muted-foreground tabular-nums [html:lang(zh)_&]:-translate-y-px">
			{count}
		</span>
	)
}
