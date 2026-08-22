export function highlightText(
	text: string,
	query: string,
): Array<{ text: string; match: boolean }> {
	const trimmed = query.trim()
	if (trimmed.length === 0) {
		return [{ text, match: false }]
	}
	const lowerQuery = trimmed.toLowerCase()
	const segments: Array<{ text: string; match: boolean }> = []
	let remaining = text

	while (remaining.length > 0) {
		const idx = remaining.toLowerCase().indexOf(lowerQuery)
		if (idx === -1) {
			segments.push({ text: remaining, match: false })
			break
		}
		if (idx > 0) {
			segments.push({ text: remaining.slice(0, idx), match: false })
		}
		segments.push({
			text: remaining.slice(idx, idx + lowerQuery.length),
			match: true,
		})
		remaining = remaining.slice(idx + lowerQuery.length)
	}

	return segments
}

export type SearchHighlightProps = {
	readonly text: string
	readonly query: string
	readonly className?: string
}

export function SearchHighlight(props: SearchHighlightProps) {
	const { text, query, className } = props
	return (
		<span className={className}>
			{highlightText(text, query).map((segment, index) =>
				segment.match ? (
					<mark
						key={index}
						className="rounded-[3px] bg-muted px-0.5 font-semibold text-foreground"
					>
						{segment.text}
					</mark>
				) : (
					<span key={index}>{segment.text}</span>
				),
			)}
		</span>
	)
}
