import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

export type ListEmptyRowProps = {
	readonly testId?: string
	readonly className?: string
	readonly children: ReactNode
}

/**
 * Dashed empty-list row — a quiet centered slot that reads as an empty
 * list item rather than a gap. Shared by comment, character, resource
 * and tag-rule lists.
 */
export function ListEmptyRow(props: ListEmptyRowProps) {
	return (
		<div
			className={cn(
				"flex min-h-9 items-center justify-center rounded-lg border border-dashed border-border-strong px-3 py-2 text-xs text-muted-foreground",
				props.className,
			)}
			data-testid={props.testId}
		>
			{props.children}
		</div>
	)
}
