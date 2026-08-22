import type { ReactNode } from "react"

type OverviewRailCardProps = {
	/** Leading icon of the header row. */
	readonly icon: ReactNode
	readonly title: ReactNode
	/** One-line muted description clarifying what the card shows. */
	readonly description: string
	/** Right-aligned "View all" affordance (link or button). */
	readonly viewAll?: ReactNode
	/** The rows below the header; skeletons included. */
	readonly rows: ReactNode
	readonly "data-testid"?: string
}

/**
 * Hero rail card (usage history / footprints): a quiet hanging list with a
 * titled header, one-line description, a right-aligned "View all" link and
 * the rows below. No card surface — reads as a quiet list. The header and
 * description always render (even while the rows load), so both cards keep
 * the same anatomy.
 */
export function OverviewRailCard(props: OverviewRailCardProps) {
	return (
		<div
			className="flex w-full flex-col sm:w-56 sm:flex-none"
			data-testid={props["data-testid"]}
		>
			<div className="flex items-center gap-2">
				{props.icon}
				<h2 className="text-sm font-semibold">{props.title}</h2>
				{props.viewAll !== undefined ? (
					<span className="ml-auto">{props.viewAll}</span>
				) : null}
			</div>
			<p className="mt-1 text-tiny text-muted-foreground">
				{props.description}
			</p>
			<div className="mt-3 flex flex-col gap-0.5">{props.rows}</div>
		</div>
	)
}

/** Shared loading row for both rail cards: 16px block + a flex-1 bar. */
export function RailRowSkeleton() {
	return (
		<div className="flex h-7 items-center gap-2">
			<span className="size-4 shrink-0 rounded bg-muted" />
			<span className="h-2.5 flex-1 rounded bg-muted" />
		</div>
	)
}
