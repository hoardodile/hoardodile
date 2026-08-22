import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

export type PillTabItem<T extends string> = {
	readonly value: T
	readonly label: ReactNode
	readonly testId?: string
	/** Toggle-state announcement for the settings variants; plain buttons
	    render without it. */
	readonly ariaPressed?: boolean
	/** Screen-reader name when the label alone is not descriptive. */
	readonly ariaLabel?: string
	/** Layout overrides for the pill (e.g. the relationship-kind grid). */
	readonly className?: string
	/** Replaces the button element entirely (e.g. a Link) — receives the
	    active state and the pill classes to apply. */
	readonly render?: (active: boolean, className: string) => ReactNode
}

export type PillTabsProps<T extends string> = {
	readonly value: T
	readonly items: readonly PillTabItem<T>[]
	readonly onChange?: (value: T) => void
	readonly className?: string
	/** Disables every pill (e.g. while a sibling control takes over). */
	readonly disabled?: boolean
}

export function pillButtonClassName(active: boolean): string {
	return cn(
		"inline-flex cursor-pointer font-medium appearance-none items-center rounded-md border-0 text-xs h-chip px-3 disabled:pointer-events-none disabled:opacity-50",
		active
			? "bg-card text-foreground"
			: "bg-transparent text-muted-foreground hover:text-secondary-foreground",
	)
}

/** Segmented pill tab group: a muted track whose active pill lifts to
    the card fill. Shared by the stats Time/Views toggle, the settings
    segmented controls, and the filter-bar toggles. */
export function PillTabs<T extends string>(props: PillTabsProps<T>) {
	const { value, items, onChange, className, disabled } = props
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5",
				className,
			)}
		>
			{items.map((item) => {
				const active = item.value === value
				const buttonClassName = pillButtonClassName(active)
				if (item.render !== undefined) {
					return (
						<span key={item.value} data-testid={item.testId}>
							{item.render(active, buttonClassName)}
						</span>
					)
				}
				return (
					<button
						key={item.value}
						type="button"
						aria-pressed={item.ariaPressed}
						aria-label={item.ariaLabel}
						data-testid={item.testId}
						disabled={disabled}
						onClick={() => onChange?.(item.value)}
						className={cn(buttonClassName, item.className)}
					>
						{item.label}
					</button>
				)
			})}
		</span>
	)
}
