import { Toggle } from "@hoardodile/ui/components/toggle"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@hoardodile/ui/components/tooltip"

export type ToolbarToggleProps = {
	readonly label: string
	readonly pressed: boolean
	readonly disabled?: boolean
	readonly onPressedChange: () => void
	readonly icon: import("react").ReactNode
}

export function ToolbarToggle(props: ToolbarToggleProps) {
	return (
		<Tooltip>
			<TooltipTrigger
				render={
					<Toggle
						size="sm"
						pressed={props.pressed}
						disabled={props.disabled}
						onPressedChange={props.onPressedChange}
						aria-label={props.label}
						className="size-7 shrink-0 px-0 text-muted-foreground transition-colors hover:text-foreground aria-pressed:bg-primary/15 aria-pressed:text-primary"
					>
						{props.icon}
					</Toggle>
				}
			/>
			<TooltipContent>{props.label}</TooltipContent>
		</Tooltip>
	)
}
