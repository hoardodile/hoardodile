import { cn } from "@hoardodile/ui/lib/utils"

export type DocCircleProps = {
	readonly className?: string
	readonly strokeWidth?: number
	/**
	 * - `static`  — still mark (default)
	 * - `draw`    — the stroke draws itself in once (landing hero)
	 * - `spin`    — continuous rotation (loading indicator)
	 * - `breathe` — slow scale/opacity pulse (ambient decoration)
	 */
	readonly variant?: "static" | "draw" | "spin" | "breathe"
}

/**
 * Doc Circle — the open hand-drawn circle mark of the documents area.
 * Used as the knowledge base's identity mark: sidebar brand, landing
 * hero, loading spinner and empty states. Color follows `currentColor`,
 * size follows the `className` (e.g. `size-7 text-primary`).
 */
export function DocCircle(props: DocCircleProps) {
	const variant = props.variant ?? "static"
	return (
		<svg
			viewBox="0 0 100 100"
			fill="none"
			aria-hidden="true"
			className={cn(
				variant === "draw" && "doc-circle-draw",
				variant === "spin" && "doc-circle-spin",
				variant === "breathe" && "doc-circle-breathe",
				props.className,
			)}
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
