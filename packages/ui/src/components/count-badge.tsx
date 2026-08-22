import { cn } from "@hoardodile/ui/lib/utils"

export type CountBadgeProps = {
	readonly count: number
	readonly className?: string
}

/**
 * Count badge — the inverted 16px pill worn by buttons to show how many
 * filters are active, how many documents are pinned, etc.
 */
export function CountBadge(props: CountBadgeProps) {
	return (
		<span
			className={cn(
				"flex size-4 items-center justify-center rounded-full bg-foreground text-tiny text-background",
				props.className,
			)}
		>
			{props.count}
		</span>
	)
}
