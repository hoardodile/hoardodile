import { Icon } from "@hoardodile/ui/components/icon"
import { Check } from "@hoardodile/ui/icons/marks"
import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

export type ChoiceCardProps = {
	readonly label: string
	readonly hint?: string
	readonly selected?: boolean
	/** Unavailable option — renders inert, without the hover lift. */
	readonly disabled?: boolean
	readonly onSelect?: () => void
	readonly children: ReactNode
	readonly className?: string
}

/**
 * ChoiceCard: a selectable option rendered as a preview over a label
 * (theme modes, palettes). Selection is a foreground ring plus a small
 * filled check badge; hover only lifts the fill, never both. Cards sit
 * in a group — they carry no shadow.
 */
export function ChoiceCard(props: ChoiceCardProps) {
	const {
		label,
		hint,
		selected = false,
		disabled = false,
		onSelect,
		children,
		className,
	} = props
	return (
		<button
			type="button"
			aria-pressed={selected}
			disabled={disabled}
			onClick={onSelect}
			className={cn(
				"group relative flex cursor-pointer flex-col overflow-hidden rounded-xl border text-left",
				selected
					? "border-foreground bg-card"
					: "border-border bg-card hover:bg-muted/60",
				disabled && "cursor-not-allowed opacity-60 hover:bg-card",
				className,
			)}
		>
			<div className="flex-1">{children}</div>
			<div className="flex items-center gap-2 px-3 py-2.5">
				<span className="truncate text-ui font-medium text-foreground">
					{label}
				</span>
				{hint !== undefined && (
					<span className="ml-auto shrink-0 text-tiny text-muted-foreground">
						{hint}
					</span>
				)}
			</div>
			{selected && (
				<span className="absolute top-2.5 right-2.5 flex size-4.5 items-center justify-center rounded-full bg-foreground text-background">
					<Icon icon={Check} size="sm" />
				</span>
			)}
		</button>
	)
}
