import { Button } from "@hoardodile/ui/components/button"
import { cn } from "@hoardodile/ui/lib/utils"

/**
 * Round, ghost-style icon button used throughout the player control
 * bar and overlay popovers. Centralised so size/colour tweaks land
 * everywhere consistently.
 */
export function IconButton(props: {
	readonly ariaLabel: string
	readonly active?: boolean
	readonly size?: "sm" | "lg"
	readonly onClick: () => void
	readonly children: React.ReactNode
}) {
	const { ariaLabel, active, size = "sm", onClick, children } = props
	return (
		<Button
			type="button"
			variant="ghost"
			size="icon"
			aria-label={ariaLabel}
			data-active={active ? "true" : "false"}
			className={cn(
				"rounded-full text-white/90 transition-none",
				"hover:bg-white/15 hover:text-white",
				"data-[active=true]:bg-primary/20 data-[active=true]:text-primary",
				size === "lg" ? "size-10" : "size-8",
			)}
			onClick={onClick}
		>
			{children}
		</Button>
	)
}
