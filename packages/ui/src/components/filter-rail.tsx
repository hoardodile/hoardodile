import { Button } from "@hoardodile/ui/components/button"
import { Checkbox } from "@hoardodile/ui/components/checkbox"
import { Separator } from "@hoardodile/ui/components/separator"
import { cn } from "@hoardodile/ui/lib/utils"
import { type ReactNode, useId } from "react"

type FilterRailProps = {
	/** Rail title, e.g. "Filters". */
	readonly title: ReactNode
	/** Header link that resets every staged filter (applies immediately). */
	readonly clearAllLabel: ReactNode
	readonly onClearAll: () => void
	/** Footer apply button label, e.g. "Show 24 resources". */
	readonly resultLabel: ReactNode
	readonly onApply: () => void
	/** When false (live-search mode) the footer apply button is omitted. */
	readonly showApply?: boolean
	/**
	 * Live-search toggle row above the apply button — checked means every
	 * filter change applies immediately instead of staging. Rendered when
	 * provided.
	 */
	readonly liveSearch?: boolean
	readonly onLiveSearchChange?: (live: boolean) => void
	readonly liveSearchLabel?: ReactNode
	readonly children: ReactNode
	readonly className?: string
}

/**
 * Filter rail: the faceted filter surface on index pages. Lives in the
 * AppShell's right panel column on wide screens and in a route-owned
 * drawer below the panel breakpoint, so it always fills its parent's
 * height and scrolls its own sections.
 */
export function FilterRail(props: FilterRailProps) {
	const {
		title,
		clearAllLabel,
		onClearAll,
		resultLabel,
		onApply,
		showApply = true,
		liveSearch,
		onLiveSearchChange,
		liveSearchLabel,
		children,
		className,
	} = props
	const liveToggleId = useId()
	return (
		<div
			className={cn("flex h-full w-full flex-col overflow-hidden", className)}
		>
			<div className="flex items-baseline px-5 pt-5">
				<span className="text-xs font-semibold tracking-label uppercase text-foreground">
					{title}
				</span>
				<button
					type="button"
					className="ml-auto cursor-pointer text-xs text-muted-foreground hover:text-secondary-foreground"
					data-testid="filter-rail-clear-all"
					onClick={onClearAll}
				>
					{clearAllLabel}
				</button>
			</div>
			<div className="flex-1 overflow-y-auto px-5 pb-5">{children}</div>
			{liveSearch !== undefined ? (
				<>
					<Separator size="seam" />
					<div className="mb-3 flex items-center justify-between px-5 pt-3">
						<div className="flex items-center gap-2">
							<Checkbox
								id={liveToggleId}
								checked={liveSearch}
								onCheckedChange={(v) => onLiveSearchChange?.(v === true)}
								data-testid="live-search-toggle"
							/>
							<label
								htmlFor={liveToggleId}
								className="cursor-pointer text-xs text-muted-foreground"
							>
								{liveSearchLabel}
							</label>
						</div>
					</div>
				</>
			) : null}
			{showApply ? (
				<div className="mb-3 px-5">
					<Button
						type="button"
						className="w-full justify-center"
						onClick={onApply}
						data-testid="filter-rail-apply"
					>
						{resultLabel}
					</Button>
				</div>
			) : null}
		</div>
	)
}

type FilterRailSectionProps = {
	/** Section label (uppercase tracking-label); omitted for the
	    label-less first panel section. */
	readonly label?: ReactNode
	/**
	 * Pad the label and content (`px-5`) while the seam stays full-bleed —
	 * detail panels whose sections take their own padding without touching
	 * the edge-to-edge separators.
	 */
	readonly padded?: boolean
	readonly children: ReactNode
}

/** One facet group; sections are separated by 2px structural seams. */
export function FilterRailSection(props: FilterRailSectionProps) {
	const { label, children, padded = false } = props
	return (
		<section className="mt-5 first:mt-4 first:pt-0 first:*:data-[slot=separator]:hidden">
			<Separator size="seam" className="mb-4" />
			<div className={padded ? "px-5" : undefined}>
				{label !== undefined ? (
					<div className="text-xs font-semibold tracking-label uppercase text-foreground">
						{label}
					</div>
				) : null}
				{label !== undefined ? (
					<div className="mt-2 flex flex-col">{children}</div>
				) : (
					children
				)}
			</div>
		</section>
	)
}
