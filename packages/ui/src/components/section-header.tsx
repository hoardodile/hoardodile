import { Icon, type IconType } from "@hoardodile/ui/components/icon"
import type { ReactNode } from "react"

/**
 * Section header: icon 16 + 16px semibold title, muted count on the
 * baseline; the right slot holds trailing controls ("View all" links,
 * toggles, marquee chevrons).
 */
export function SectionHeader({
	icon,
	title,
	count,
	viewAll,
	onViewAll,
	right,
	className,
}: {
	readonly icon?: IconType
	readonly title: string
	/** Muted count rendered right after the title, e.g. "(2)". */
	readonly count?: string
	/** Label for the right-aligned "View all" text link. */
	readonly viewAll?: string
	readonly onViewAll?: () => void
	/** Right-aligned trailing slot (the ml-auto position). */
	readonly right?: ReactNode
	readonly className?: string
}) {
	return (
		<div className={`flex items-center gap-2 ${className ?? ""}`}>
			{icon !== undefined ? (
				<Icon icon={icon} className="text-secondary-foreground" />
			) : null}
			<span className="text-base font-semibold text-foreground">{title}</span>
			{count !== undefined ? (
				<span className="text-xs text-muted-foreground">{count}</span>
			) : null}
			{viewAll !== undefined || right !== undefined ? (
				<span className="ml-auto flex items-center gap-4">
					{viewAll !== undefined ? (
						<button
							type="button"
							onClick={onViewAll}
							className="cursor-pointer text-xs text-muted-foreground hover:text-secondary-foreground"
						>
							{viewAll}
						</button>
					) : null}
					{right}
				</span>
			) : null}
		</div>
	)
}
