import { cn } from "@hoardodile/ui/lib/utils"
import type * as React from "react"

type SurfaceProps<C extends React.ElementType = "div"> = {
	as?: C
	size?: "default" | "compact"
	/**
	 * Visual tone. `flat` (default) is the hairline card
	 */
	tone?: "flat"
} & Omit<React.ComponentPropsWithoutRef<C>, "as" | "size" | "tone">

function Surface<C extends React.ElementType = "div">({
	as,
	size = "default",
	tone = "flat",
	className,
	...props
}: SurfaceProps<C>) {
	const Component = as || "div"
	return (
		<Component
			data-slot="surface"
			data-size={size}
			data-tone={tone}
			className={cn(
				"rounded-md border bg-card text-card-foreground",
				size === "default" && "p-4",
				size === "compact" && "p-2",
				className,
			)}
			{...props}
		/>
	)
}

export { Surface }
