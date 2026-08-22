import { cn } from "@hoardodile/ui/lib/utils"

export type DocSpinProps = {
	readonly className?: string
	readonly strokeWidth?: number
}

/**
 * Doc Spin — the open hand-drawn circle mark of the documents area,
 * spinning as the section's loading indicator. Color follows
 * `currentColor`, size follows the `className` (e.g. `size-10 text-primary/70`).
 */
export function DocSpin(props: DocSpinProps) {
	return (
		<svg
			viewBox="0 0 100 100"
			fill="none"
			aria-hidden="true"
			className={cn("doc-circle-spin", props.className)}
		>
			<path
				d="M 30.3 87.1 A 42 42 0 1 1 69.7 87.1"
				pathLength={1}
				stroke="currentColor"
				strokeWidth={props.strokeWidth ?? 6}
				strokeLinecap="round"
				transform="rotate(-14 50 50)"
			/>
		</svg>
	)
}
