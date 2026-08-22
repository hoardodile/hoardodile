import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

type OverviewSectionCardProps = {
	readonly title: ReactNode
	readonly description?: ReactNode
	readonly action?: ReactNode
	readonly children: ReactNode
	readonly className?: string
	readonly "data-testid"?: string
}

/**
 * Borderless dashboard section: hierarchy comes from whitespace and type
 * weight instead of a nested card surface.
 */
export function OverviewSectionCard(props: OverviewSectionCardProps) {
	return (
		<section
			className={cn("flex min-w-0 flex-col gap-4", props.className)}
			data-testid={props["data-testid"]}
		>
			{(props.title !== undefined ||
				props.description !== undefined ||
				props.action !== undefined) && (
				<div className="flex items-center justify-between gap-2">
					<div className="min-w-0 space-y-1">
						<h2 className="text-base font-semibold">{props.title}</h2>
						{props.description !== undefined ? (
							<p className="text-xs text-muted-foreground">
								{props.description}
							</p>
						) : null}
					</div>
					{props.action !== undefined ? (
						<div className="shrink-0">{props.action}</div>
					) : null}
				</div>
			)}
			<div className="min-w-0">{props.children}</div>
		</section>
	)
}
