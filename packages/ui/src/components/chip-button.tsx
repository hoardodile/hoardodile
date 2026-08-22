import type { IconType } from "@hoardodile/ui/components/icon"
import { Icon } from "@hoardodile/ui/components/icon"
import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

export type ChipButtonProps = {
	readonly icon?: IconType
	/** Latched-toggle state — accent fill, no hover shift. */
	readonly active?: boolean
	/** The dashed outline (the Unused triage filter) instead of the quiet
	    text idle state. */
	readonly dashed?: boolean
	readonly disabled?: boolean
	readonly children: ReactNode
	readonly className?: string
	readonly onClick?: () => void
	readonly testId?: string
}

/**
 * Chip button: the toolbar's compact toggle, h-chip height. Two kinds:
 * the quiet toggle (Reorder) wears medium weight in both states so its
 * width never moves; the dashed filter (Unused) is an indicator, not a
 * toggle, so it stays regular weight with a dashed outline. `active`
 * latches the accent fill on both; the dashed outline keeps a transparent
 * border when active so the width never shifts.
 */
export function ChipButton(props: ChipButtonProps) {
	const {
		icon,
		active,
		dashed,
		disabled,
		children,
		className,
		onClick,
		testId,
	} = props
	return (
		<button
			type="button"
			onClick={disabled ? undefined : onClick}
			data-testid={testId}
			disabled={disabled}
			className={cn(
				"inline-flex h-chip shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs whitespace-nowrap",
				!dashed && "font-medium",
				disabled ? "cursor-default" : "cursor-pointer",
				active && "bg-accent text-foreground",
				// The dashed outline keeps a 1px transparent border when
				// active so the width never moves with the state.
				active && dashed && "border border-transparent",
				!active && disabled && "text-muted-foreground",
				!active &&
					!disabled &&
					dashed &&
					"border border-dashed border-border-strong bg-card text-muted-foreground hover:text-secondary-foreground",
				!active &&
					!disabled &&
					!dashed &&
					"text-secondary-foreground hover:text-foreground",
				className,
			)}
		>
			{icon !== undefined ? <Icon icon={icon} /> : null}
			{children}
		</button>
	)
}
