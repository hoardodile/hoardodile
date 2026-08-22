/**
 * Pure color utilities used by tag/category chip rendering.
 *
 * Centralized here so chip components, color pickers, and tests share
 * one definition for "looks white"/"looks black" and the color-mix
 * blending used to keep chips subtle on cards and sidebars.
 */

export const TAG_SPECIAL_STYLES = [
	"silver",
	"gold",
	"rainbow",
	"oilslick",
	"kintsugi",
] as const

/** Default color presets shared by every color picker in the app. */
export const DEFAULT_COLOR_PRESETS = [
	"#9D9D9D",
	"#000000",
	"#FFFFFF",
	"#27AE60",
	"#0070DD",
	"#00BCD4",
	"#8E44AD",
	"#FF8000",
	"#F1C40F",
	"#E74C3C",
] as const

export type TagSpecialStyle = (typeof TAG_SPECIAL_STYLES)[number]

export function isSpecialTagStyle(color: string): color is TagSpecialStyle {
	return TAG_SPECIAL_STYLES.includes(color as TagSpecialStyle)
}

export type TagChipColors = {
	readonly baseBg: string
	readonly hoverBg: string
	readonly fg: string
}

const WHITE_COLOR_PATTERN =
	/^(?:#fff(?:fff)?|white|rgba?\(\s*255\s*,\s*255\s*,\s*255\b)/i
const BLACK_COLOR_PATTERN =
	/^(?:#000(?:000)?|black|rgba?\(\s*0\s*,\s*0\s*,\s*0\b)/i

/**
 * Tests whether a CSS color string visually resolves to white in any
 * common short form (`#fff`, `#ffffff`, `white`, `rgb(255,255,255,…)`).
 */
export function isWhiteHex(color: string): boolean {
	if (color === "") return false
	return WHITE_COLOR_PATTERN.test(color.trim())
}

/** Mirror of {@link isWhiteHex} for black. */
export function isBlackHex(color: string): boolean {
	if (color === "") return false
	return BLACK_COLOR_PATTERN.test(color.trim())
}

/**
 * Resolve a chip's background/hover/foreground triple for the given
 * `color`. White and black are special-cased so they remain visibly
 * black/white in both light and dark themes instead of vanishing into
 * the chip background.
 */
export function computeTagChipColors(color: string): TagChipColors {
	if (color === "") {
		return {
			baseBg: "var(--color-muted)",
			hoverBg: "var(--color-accent)",
			fg: "var(--color-foreground)",
		}
	}
	if (isWhiteHex(color)) {
		return {
			baseBg: "#ffffff",
			hoverBg: "#f1f5f9",
			fg: "#0a0a0a",
		}
	}
	if (isBlackHex(color)) {
		return {
			baseBg: "#0a0a0a",
			hoverBg: "#262626",
			fg: "#ffffff",
		}
	}
	return {
		baseBg: `color-mix(in srgb, ${color} 6%, var(--color-card))`,
		hoverBg: `color-mix(in srgb, ${color} 20%, var(--color-card))`,
		fg: color,
	}
}
