import { Icon, type IconType } from "@hoardodile/ui/components/icon"
import type { ReactNode } from "react"
import { SectionCount } from "./SectionCount"

type SectionTitleProps = {
	/** Leading glyph of the header row. */
	readonly icon: IconType
	readonly title: ReactNode
	/** Quiet count of currently displayed items, when available. */
	readonly count?: number
	/** Right-side extras riding the header row (e.g. marquee chevrons). */
	readonly controls?: ReactNode
}

/**
 * Dashboard section header row: icon + title + quiet count + optional
 * controls — the shared anatomy of the overview's section titles (pinned
 * resources / pinned characters / on this day / recent activity).
 *
 * The row baseline-aligns like {@link PageHeader}'s title + count: centering
 * boxes would put the tiny count's baseline ~2px above the title's
 * (`text-tiny` carries a 16px line box), which reads as floating high.
 * Icon and controls stay box-centered via `self-center`.
 */
export function SectionTitle(props: SectionTitleProps) {
	return (
		<div className="flex items-baseline gap-2">
			<Icon
				icon={props.icon}
				className="self-center text-secondary-foreground"
			/>
			{props.title}
			<SectionCount count={props.count} />
			{props.controls !== undefined ? (
				<span className="flex items-center self-center">{props.controls}</span>
			) : null}
		</div>
	)
}
