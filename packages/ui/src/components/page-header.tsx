import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

type PageHeaderProps = {
	readonly title?: ReactNode
	/** Muted total on the title baseline (e.g. the item count). */
	readonly count?: string
	readonly description?: ReactNode
	readonly actions?: ReactNode
	readonly className?: string
}

/**
 * Page header — 28px bold title with the total count muted on its baseline,
 * optional muted description below, page actions on the right. The literary
 * serif (font-doc) is scoped to the documents section; chrome and index
 * pages speak in the app sans.
 */
export function PageHeader(props: PageHeaderProps) {
	const { title, count, description, actions, className } = props
	return (
		<header className={cn("mb-6", className)}>
			<div className="flex flex-wrap items-end justify-between gap-x-6 gap-y-3">
				<div className="flex min-w-0 items-baseline gap-3">
					{title !== undefined ? (
						<h1 className="text-doc-heading font-bold text-foreground">
							{title}
						</h1>
					) : null}
					{count !== undefined ? (
						<span className="text-ui text-muted-foreground">{count}</span>
					) : null}
				</div>
				{actions !== undefined ? (
					// `ml-auto` keeps a wrapped actions line right-aligned on
					// narrow viewports, matching the same-line justify-between.
					<div className="ml-auto flex shrink-0 flex-wrap items-center gap-4 pb-1">
						{actions}
					</div>
				) : null}
			</div>
			{description !== undefined ? (
				<p className="mt-2 text-ui text-muted-foreground">{description}</p>
			) : null}
		</header>
	)
}
