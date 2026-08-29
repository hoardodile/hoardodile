import {
	DropdownMenu,
	DropdownMenuContent,
	DropdownMenuTrigger,
} from "@hoardodile/ui/components/dropdown-menu"
import { Icon } from "@hoardodile/ui/components/icon"
import { SpecialTagSurface } from "@hoardodile/ui/components/special-tag-surface"
import { AltArrowDown, Pin } from "@hoardodile/ui/icons/registry"
import {
	type ResolvedTagChipSurface,
	resolveTagChipSurface,
} from "@hoardodile/ui/lib/tag-surface"
import { cn } from "@hoardodile/ui/lib/utils"
import type { KeyboardEvent, ReactNode } from "react"

/**
 * The rail group's tint — shared between the chip half and the glued
 * chevron half so both wear the same surface. Follows {@link TagChip}'s
 * coloring exactly (the same resolveTagChipSurface): a plain color tints
 * with a deepening hover, the five special styles render their texture,
 * and an empty color falls back to the muted chip, taking the primary
 * fill when active. `warning` (unused) drops the tint for the dashed
 * outline.
 */
export function railChipSurface(
	color: string,
	active: boolean,
	warning: boolean,
): ResolvedTagChipSurface | undefined {
	if (warning) return undefined
	return resolveTagChipSurface(color, active)
}

const railHalfClassName =
	"inline-flex h-chip min-w-0 items-center rounded-md px-2.5 text-xs leading-none"

/**
 * Category rail group: the two halves of one selectable row — the
 * left-rounded chip (label, pinned mark, hugging count) and the
 * right-rounded chevron whose menu carries the row's actions. A
 * button-group: the halves share one surface and only the rounded side
 * differs. `active` changes the color alone (the same deepen/primary fill
 * as {@link TagChip}, never a weight shift).
 */
export function CategoryRailGroup(props: {
	readonly label: string
	readonly color?: string
	/** Trailing readout — "· 12", hugging the label. */
	readonly count?: number
	/** Pinned marker — the small pin before the label. */
	readonly pinned?: boolean
	/** Selection state — same size, deeper tint of the same hue. */
	readonly active?: boolean
	/** Unused entity — dashed outline instead of the tint. */
	readonly warning?: boolean
	/** Chip half click — selects the category. */
	readonly onSelect?: () => void
	/** Chevron More menu trigger label (aria). */
	readonly menuLabel: string
	readonly menuOpen: boolean
	readonly onMenuOpenChange: (open: boolean) => void
	/** The chevron menu's items (edit/delete). */
	readonly menuItems: ReactNode
	readonly chipTestId?: string
	readonly className?: string
}) {
	const {
		label,
		color = "",
		count,
		pinned,
		active = false,
		warning = false,
		onSelect,
		menuLabel,
		menuOpen,
		onMenuOpenChange,
		menuItems,
		chipTestId,
		className,
	} = props
	const surf = railChipSurface(color, active, warning)
	// The chevron keeps the category's base tint at all times — selection
	// never changes it, only its own hover deepens it.
	const chevronSurf = railChipSurface(color, false, warning)

	function handleKeyDown(event: KeyboardEvent<HTMLSpanElement>) {
		if (event.key !== "Enter" && event.key !== " ") return
		event.preventDefault()
		onSelect?.()
	}

	return (
		<span className={cn("inline-flex min-w-0 items-center", className)}>
			<span
				role={onSelect !== undefined ? "button" : undefined}
				tabIndex={onSelect !== undefined ? 0 : undefined}
				title={label}
				onClick={onSelect}
				onKeyDown={onSelect !== undefined ? handleKeyDown : undefined}
				className={cn(
					railHalfClassName,
					"min-w-0 flex-1 gap-1.5 rounded-r-none",
					surf?.className,
					warning &&
						(active
							? "border border-transparent bg-accent text-foreground"
							: "border border-dashed border-border-strong text-muted-foreground hover:text-secondary-foreground"),
					onSelect !== undefined && "cursor-pointer",
				)}
				style={surf?.style}
				data-testid={chipTestId}
			>
				{surf?.texture !== null && surf?.texture !== undefined && (
					<SpecialTagSurface
						style={surf.texture}
						active={active}
						className="absolute inset-0 -z-10 overflow-hidden rounded-[inherit]"
					/>
				)}
				{pinned !== undefined && pinned ? (
					<Pin
						className={cn(
							"inline size-3 shrink-0",
							surf ? "opacity-70" : "text-muted-foreground",
						)}
						aria-hidden
					/>
				) : null}
				<span className="min-w-0 flex-1 truncate text-left">
					{label}
					{count !== undefined ? (
						<>
							<span className="font-bold mx-0.5">·</span>
							<span className={surf ? "opacity-70" : "text-muted-foreground"}>
								{count}
							</span>
						</>
					) : null}
				</span>
			</span>
			<DropdownMenu modal={false} onOpenChange={onMenuOpenChange}>
				<DropdownMenuTrigger
					render={
						<button
							type="button"
							title={menuLabel}
							aria-label={menuLabel}
							className={cn(
								railHalfClassName,
								"w-7 shrink-0 justify-center rounded-l-none px-0",
								chevronSurf && "border-l border-border",
								chevronSurf
									? chevronSurf.className
									: menuOpen
										? "border-y border-r border-dashed border-transparent bg-accent text-accent-foreground"
										: "border-y border-r border-dashed border-border-strong bg-card text-muted-foreground hover:text-secondary-foreground",
							)}
							style={chevronSurf?.style}
						>
							<Icon icon={AltArrowDown} size="sm" />
						</button>
					}
				/>
				<DropdownMenuContent align="end" className="min-w-36">
					{menuItems}
				</DropdownMenuContent>
			</DropdownMenu>
		</span>
	)
}
