import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"

export type CardShellProps = Readonly<{
	/**
	 * Leading tile (a plugin icon, a domain icon). Cards pass their own tile
	 * component so the shell stays domain-agnostic.
	 */
	readonly icon: ReactNode
	/**
	 * What the card's section is called ("Plugins", "Backups", …), shown as
	 * the leading tile's hover hint and accessible name. Deliberately not the
	 * item's own name: the tile is the domain mark, the title line is the item.
	 */
	readonly iconTitle?: string
	readonly title: ReactNode
	/** Mono meta line under the title (version, date · size, …). */
	readonly meta?: ReactNode
	/** Overrides the meta line's type ramp — e.g. a text-sized `v1 · date ·
	    size` line on the archive card, whose meta the user reads as content. */
	readonly metaClassName?: string
	/**
	 * The description line every card reserves: two clamped lines at a fixed
	 * height, so a one-line or missing description does not shorten the card
	 * and the grid keeps one rhythm.
	 */
	readonly description: string
	/** Rendered before the header: top banners and ticker strips. */
	readonly banner?: ReactNode
	/**
	 * Trailing header slot for a control that belongs to the identity row
	 * (a switch). Corner-state icons belong in {@link footer}, next to the
	 * other state marks.
	 */
	readonly trailing?: ReactNode
	/** Bottom row: state marks on the left, actions pushed to the right. */
	readonly footer?: ReactNode
	readonly className?: string
	readonly "data-testid"?: string
}>

/**
 * The one small-card anatomy the app's grids share — marketplace catalog
 * cards, plugins-page cards and the bundled-plugins cards, plus the archive
 * and backup cards. Sheet-flat (hairline border, no fill), a tile + title +
 * mono meta header, the reserved two-line description, and a bottom row of
 * state marks and actions.
 *
 * It exists so a new card cannot drift: the description clamp, the header
 * spacing and the footer alignment are stated once. Callers own everything
 * inside the slots (their menus, dialogs and labels).
 */
export function CardShell(props: CardShellProps) {
	const { icon, iconTitle, title, meta, metaClassName, description, banner } =
		props
	return (
		<div
			className={cn(
				"relative flex flex-col gap-2.5 overflow-hidden rounded-xl border border-border p-4 transition-colors hover:bg-accent/40",
				props.className,
			)}
			data-testid={props["data-testid"]}
		>
			{banner}
			<CardIdentity
				icon={icon}
				iconTitle={iconTitle}
				title={title}
				meta={meta}
				metaClassName={metaClassName}
				trailing={props.trailing}
			/>
			<p
				className="line-clamp-2 min-h-8 text-xs text-muted-foreground"
				data-slot="card-description"
			>
				{description}
			</p>
			{props.footer !== undefined ? (
				<div className="flex min-w-0 flex-wrap items-center gap-1.5">
					{props.footer}
				</div>
			) : null}
		</div>
	)
}

/** The header row on its own, for callers that need the identity without the
    description/footer rhythm (the plugins page's list rows). */
export function CardIdentity(props: {
	readonly icon: ReactNode
	readonly iconTitle?: string
	readonly title: ReactNode
	readonly meta?: ReactNode
	readonly metaClassName?: string
	readonly trailing?: ReactNode
}) {
	return (
		<div className="flex items-center gap-2.5">
			{props.iconTitle !== undefined ? (
				// The tile is the section's mark, so its hint names the section
				// rather than repeating the item title next to it.
				<span
					className="flex shrink-0"
					title={props.iconTitle}
					aria-label={props.iconTitle}
					data-slot="card-icon"
				>
					{props.icon}
				</span>
			) : (
				props.icon
			)}
			<div className="min-w-0 flex-1">
				<span
					className="block truncate text-ui font-medium"
					// A truncated title still needs its full text on hover; a
					// non-string title (a composed node) simply has no hint.
					title={
						typeof props.title === "string" ? props.title : undefined
					}
				>
					{props.title}
				</span>
				{props.meta !== undefined &&
				!(typeof props.meta === "string" && props.meta.length === 0) ? (
					<span
						className={cn(
							"block truncate font-mono text-tiny text-muted-foreground",
							props.metaClassName,
						)}
					>
						{props.meta}
					</span>
				) : null}
			</div>
			{props.trailing}
		</div>
	)
}
