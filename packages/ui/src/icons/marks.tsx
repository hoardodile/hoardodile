/**
 * Local utility marks — the three plain glyphs Solar's vocabulary lacks
 * (its ✓/×/+ only exist inside Circle/Square containers, whose marks occupy
 * barely a third of the box and go muddy below 16px). These are drawn
 * in-house for the spots where a bare mark is the whole meaning: checkbox
 * ticks, selected badges, pill clears, add affordances.
 *
 * Check and Cross are strokes in Solar's language (24 viewBox, round caps)
 * at 2 units — diagonals anti-alias gracefully at any tier. Plus is a
 * filled cross instead: its pure orthogonal edges land on integer pixels
 * at the md tier (3-unit arms render as a crisp 2px bar at 16px), where a
 * 1.33px stroke would straddle pixel boundaries and blur. Weight-insensitive:
 * no tone layer, no weight variants. Original geometry — not derived
 * from Solar assets.
 *
 * Marks ride the same `mode` channel as registry icons (declared, ignored):
 * a check is a check in every weight.
 */
import type { IconMode } from "./icon-style.ts"

type MarkProps = {
	className?: string
	mode?: IconMode
}

function Mark({
	d,
	filled,
	className,
}: MarkProps & { d: string; filled?: boolean }) {
	return (
		<svg
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			className={className}
		>
			{filled ? (
				<path d={d} fill="currentColor" />
			) : (
				<path
					d={d}
					stroke="currentColor"
					strokeWidth="2"
					strokeLinecap="round"
					strokeLinejoin="round"
				/>
			)}
		</svg>
	)
}

/** Plain ✓ — checkbox ticks, selected badges. */
export function Check(props: MarkProps) {
	return <Mark {...props} d="M5 12.8l4.7 4.7L19 7.2" />
}

/** Plain × — pill and chip clears. */
export function Cross(props: MarkProps) {
	return <Mark {...props} d="M6 6l12 12M18 6L6 18" />
}

/** Plain + — add affordances. Filled cross, 3-unit arms spanning 5–19. */
export function Plus(props: MarkProps) {
	return (
		<Mark
			{...props}
			filled
			d="M10.5 5h3v5.5H19v3h-5.5V19h-3v-5.5H5v-3h5.5V5Z"
		/>
	)
}
