import { cn } from "@hoardodile/ui/lib/utils"
import type { ComponentPropsWithoutRef } from "react"

/**
 * The `TextBtn` pattern: inline text action — 12px muted, hover softens
 * to secondary. Used by the message footer actions (votes, reply, more)
 * and the composer's attach buttons.
 */
export function MessageTextAction(
	props: ComponentPropsWithoutRef<"button"> & { readonly className?: string },
) {
	const { className, type = "button", ...rest } = props
	return (
		<button
			type={type}
			className={cn(
				"inline-flex cursor-pointer items-center gap-1.5 border-0 bg-transparent p-0 text-xs text-muted-foreground transition-colors hover:text-secondary-foreground disabled:cursor-not-allowed disabled:opacity-50",
				className,
			)}
			{...rest}
		/>
	)
}
