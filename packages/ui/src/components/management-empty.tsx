import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

export type ManagementEmptyProps = {
	readonly testId?: string
	readonly className?: string
	readonly children: ReactNode
}

/**
 * Dashed empty-state placeholder shared by entity-management panels.
 */
export function ManagementEmpty(props: ManagementEmptyProps) {
	return (
		<div
			className={cn(
				"w-full rounded-lg border border-dashed bg-muted/20 px-4 py-3 text-sm text-muted-foreground",
				props.className,
			)}
			data-testid={props.testId}
		>
			{props.children}
		</div>
	)
}
