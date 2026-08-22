import type { ComponentType } from "react"
import { cn } from "../lib/utils.ts"
import type { IconMode } from "../icons/icon-style.ts"

/** Anything renderable through `Icon`: a Solar icon (imported from the
    central registry on the web side) or a local utility mark (marks.tsx) —
    both take `className`; registry icons take `mode` (marks ignore it). */
export type IconType = ComponentType<{ className?: string; mode?: IconMode }>

/** The three sanctioned icon sizes: `sm` 12 inside pills and meta lines,
    `md` 16 by default, `lg` 20 for primary toolbar actions. */
export type IconSize = "sm" | "md" | "lg"

const sizeClasses = {
	sm: "size-3",
	md: "size-4",
	lg: "size-5",
} as const satisfies Record<IconSize, string>

/**
 * Solar icons with the design system's defaults baked in: callers pass
 * the registry icon — by default it renders the boldDuotone weight,
 * whose second tone takes the palette's `--icon-tone` hue (theme.css
 * recolors the duotone accent via `--solar-secondary-color` under the
 * `hd-icon` hook), so colored palettes feel alive while mono stays
 * neutral.
 *
 * Mode is one channel: `mode` picks the weight directly; `selected` maps
 * to `"bold"` (the filled, single-color weight — the only sanctioned use
 * of Bold); otherwise the active icon style preference decides.
 *
 * Sizing is class-based, three tiers only — `sm`/`md`/`lg` map to
 * `size-3/4/5` (12/16/20). Escape the tiers with
 * `className="size-[18px]"` — twMerge lets the later class win.
 *
 * ✓/×/+ semantics never use Solar's Circle/Square composites — the
 * container is full-bleed while the informative mark is barely a third
 * of the box, so it goes muddy at small sizes. The plain marks (Check,
 * Cross, Plus from marks.tsx) cover these at every size; `sm` otherwise
 * belongs to simple single-stroke glyphs (arrows, dots, grips).
 */
export function Icon({
	icon: IconComponent,
	mode,
	size = "md",
	selected,
	className,
	...rest
}: {
	icon: IconType
	/** Explicit weight override; `selected` and the style preference lose
	    to it. */
	mode?: IconMode
	size?: IconSize
	/** Selected state — renders the icon's `"bold"` weight. */
	selected?: boolean
	className?: string
} & Record<string, unknown>) {
	return (
		<IconComponent
			mode={mode ?? (selected === true ? "bold" : undefined)}
			className={cn("hd-icon", sizeClasses[size], className)}
			{...rest}
		/>
	)
}
