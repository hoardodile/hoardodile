import { getSpecialTagStyleConfig } from "@hoardodile/ui/components/special-tag-surface"
import {
	computeTagChipColors,
	isSpecialTagStyle,
	type TagSpecialStyle,
} from "@hoardodile/ui/lib/colors"
import { cn } from "@hoardodile/ui/lib/utils"
import type { CSSProperties } from "react"

export type ResolvedTagChipSurface = {
	readonly className: string
	readonly style: CSSProperties | undefined
	/** The special SVG texture to layer under the chip's content, or null. */
	readonly texture: TagSpecialStyle | null
}

/**
 * Resolves a chip's visual surface for a user-assigned color — the single
 * source of chip coloring shared by every tag/category pill in the app.
 *
 * A plain color tints the whole chip (a 6% wash as fill, the color as ink,
 * deepening to the hover tint when `active`); the five special styles
 * (silver, gold, rainbow, oilslick, kintsugi) render their SVG texture;
 * an empty color falls back to the default muted chip, taking the primary
 * fill when `active`.
 */
export function resolveTagChipSurface(
	color: string,
	active: boolean,
): ResolvedTagChipSurface {
	if (isSpecialTagStyle(color)) {
		const config = getSpecialTagStyleConfig(color)
		return {
			className: cn(
				"relative isolate group",
				config.default.className,
				active ? config.active?.className : undefined,
			),
			style: {
				...config.default.style,
				...(active ? config.active?.style : {}),
			},
			texture: color,
		}
	}

	if (color === "") {
		return active
			? {
					className: "bg-primary text-primary-foreground hover:bg-primary/90",
					style: undefined,
					texture: null,
				}
			: {
					className: "bg-muted text-foreground hover:bg-accent",
					style: undefined,
					texture: null,
				}
	}

	const chipColors = computeTagChipColors(color)
	return {
		className: "bg-(--chip-bg) hover:bg-(--chip-hover-bg)",
		style: {
			["--chip-bg" as string]: active ? chipColors.hoverBg : chipColors.baseBg,
			["--chip-hover-bg" as string]: chipColors.hoverBg,
			color: chipColors.fg,
		},
		texture: null,
	}
}
