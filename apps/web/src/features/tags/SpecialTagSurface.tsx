import { cn } from "@hoardodile/ui/lib/utils"
import { useId } from "react"
import type { TagSpecialStyle } from "@/lib/colors"
import { goldConfig } from "./special/gold"
import { kintsugiConfig } from "./special/kintsugi"
import { oilslickConfig } from "./special/oilslick"
import { rainbowConfig } from "./special/rainbow"
import { silverConfig } from "./special/silver"
import type { SpecialTagStyleConfig } from "./special/types"

export type SpecialTagSurfaceProps = {
	readonly style: TagSpecialStyle
	readonly active?: boolean
	readonly className?: string
}

const SPECIAL_TAG_CONFIG: Record<TagSpecialStyle, SpecialTagStyleConfig> = {
	silver: silverConfig,
	gold: goldConfig,
	rainbow: rainbowConfig,
	oilslick: oilslickConfig,
	kintsugi: kintsugiConfig,
}

export function getSpecialTagStyleConfig(
	style: TagSpecialStyle,
): SpecialTagStyleConfig {
	return SPECIAL_TAG_CONFIG[style]
}

/**
 * SVG background surface for special tag styles.
 *
 * Each style owns a self-contained SVG renderer in `features/tags/special/`.
 * This component only picks the right renderer from the registry and applies
 * positioning; all styling (filters, colors, shadows) lives in the renderer or
 * the chip container config.
 */
export function SpecialTagSurface(props: SpecialTagSurfaceProps) {
	const { style, active, className } = props
	const config = SPECIAL_TAG_CONFIG[style]
	const Renderer = config.render
	const reactId = useId()
	// React useId() can produce ids containing colons, which break SVG
	// url(#id) references in some browsers. Replace them with a safe delimiter.
	const safeId = reactId.replace(/:/g, "-")

	return (
		<span className={cn(className)} aria-hidden="true">
			<Renderer id={safeId} active={active} />
		</span>
	)
}
