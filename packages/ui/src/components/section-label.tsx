import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

/**
 * Section label — the 12px uppercase tracking-label voice (DESIGN.md —
 * Typography), one component instead of a class string repeated across
 * panels, rails, dialogs and settings. Ink tones: `muted` (default, the
 * quiet section voice), `foreground` (structural headings), `danger`
 * (the dialog eyebrow of a destructive ritual). Callers with a
 * right-aligned count arrange it inside `children` (flex via
 * `className`) — the voice is the unit.
 */
export function SectionLabel({
	tone = "muted",
	size = "xs",
	className,
	children,
}: {
	tone?: "muted" | "foreground" | "danger"
	size?: "xs" | "tiny"
	className?: string
	children: ReactNode
}) {
	return (
		<div
			className={cn(
				size === "tiny" ? "text-tiny leading-none" : "text-xs",
				"font-semibold tracking-label uppercase",
				tone === "foreground"
					? "text-foreground"
					: tone === "danger"
						? "text-destructive"
						: "text-muted-foreground",
				className,
			)}
		>
			{children}
		</div>
	)
}
