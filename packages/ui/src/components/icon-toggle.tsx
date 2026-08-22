import { Icon, type IconType } from "@hoardodile/ui/components/icon"
import { cn } from "@hoardodile/ui/lib/utils"

export type IconToggleOption<T extends string> = {
	readonly value: T
	readonly icon: IconType
	/** Accessible name (also the tooltip). */
	readonly label: string
	readonly testId?: string
}

type IconToggleProps<T extends string> = {
	readonly value: T
	readonly options: readonly IconToggleOption<T>[]
	readonly onChange: (value: T) => void
	readonly className?: string
}

/**
 * Icon toggle: a segmented control of square icon buttons (grid/masonry
 * view switchers). Muted track; the active button lifts to the card fill
 * and its icon takes the Bold weight.
 */
export function IconToggle<T extends string>(props: IconToggleProps<T>) {
	const { value, options, onChange, className } = props
	return (
		<span
			className={cn(
				"inline-flex shrink-0 items-center gap-0.5 rounded-lg bg-muted p-0.5",
				className,
			)}
		>
			{options.map((option) => {
				const active = option.value === value
				return (
					<button
						type="button"
						key={option.value}
						title={option.label}
						aria-label={option.label}
						aria-pressed={active}
						data-testid={option.testId}
						onClick={() => onChange(option.value)}
						className={cn(
							"flex size-7 cursor-pointer items-center justify-center rounded-md",
							active
								? "bg-card text-foreground"
								: "text-muted-foreground hover:text-secondary-foreground",
						)}
					>
						<Icon icon={option.icon} selected={active} className="size-4" />
					</button>
				)
			})}
		</span>
	)
}
