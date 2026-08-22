import { List } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import { memo, useState } from "react"
import { useTranslation } from "react-i18next"

export type HeadingInfo = {
	readonly id: string
	readonly level: number
	readonly text: string
}

export type DocHeadingNavProps = {
	readonly headings: readonly HeadingInfo[]
	readonly onNavigate: (blockId: string) => void
	readonly className?: string
}

/**
 * Renders a clickable outline of document headings for quick navigation.
 * Each row pairs an 11px muted level label (H1/H2/H3…) with a 13px title,
 * indented 16px per level; the current row carries a 2px text-color bar
 * on its left edge. Used in the right side panel (CONTENTS tab) and
 * inside the drawer below the panel breakpoint.
 */
export const DocHeadingNav = memo(function DocHeadingNav(
	props: DocHeadingNavProps,
) {
	const { headings, onNavigate } = props
	const { t } = useTranslation()
	const [activeId, setActiveId] = useState<string>()
	if (headings.length === 0) {
		return (
			<div
				className={cn(
					"px-4 py-6 text-center text-sm text-muted-foreground",
					props.className,
				)}
			>
				<List className="mx-auto mb-2 size-5 opacity-40" strokeWidth={1.6} />
				{t("documents.noHeadings")}
			</div>
		)
	}

	// The clicked entry stays active; fall back to the first heading so the
	// accent marker is always visible before any interaction.
	const active =
		activeId !== undefined && headings.some((h) => h.id === activeId)
			? activeId
			: headings[0]?.id

	return (
		<nav className={cn(props.className)}>
			{headings.map((h) => (
				<button
					key={h.id}
					type="button"
					aria-current={h.id === active ? "true" : undefined}
					className={cn(
						"flex w-full items-baseline gap-3 border-l-2 py-1.5 pr-2 text-left transition-colors duration-200",
						h.id === active
							? "border-foreground"
							: "border-transparent hover:bg-muted/60",
					)}
					style={{ paddingLeft: `${0.5 + (h.level - 1) * 1}rem` }}
					onClick={() => {
						setActiveId(h.id)
						onNavigate(h.id)
					}}
				>
					<span className="w-4 shrink-0 text-[11px] text-muted-foreground">
						H{h.level}
					</span>
					<span
						className={cn(
							"truncate text-[13px]",
							h.level <= 2
								? "font-semibold text-foreground"
								: "text-secondary-foreground",
						)}
					>
						{h.text.length > 0 ? (
							h.text
						) : (
							<span className="italic opacity-50">
								{t("documents.untitledHeading")}
							</span>
						)}
					</span>
				</button>
			))}
		</nav>
	)
})
