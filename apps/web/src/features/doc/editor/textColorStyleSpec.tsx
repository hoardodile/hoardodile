import { COLORS_DEFAULT } from "@blocknote/core"
import { createReactStyleSpec } from "@blocknote/react"

/**
 * Resolve the color string that should actually be applied to the text.
 *
 * - "default" / empty means "no color".
 * - Named colors from BlockNote's default palette (gray, red, ...) are mapped
 *   to the palette's text color so they stay consistent with existing content.
 * - Anything else (custom hex, rgb, css color name) is used as-is.
 */
export function resolveTextColor(value: string): string | undefined {
	if (value === "" || value === "default") return undefined
	return COLORS_DEFAULT[value]?.text ?? value
}

/**
 * Custom `textColor` style spec that supports arbitrary CSS colors,
 * including hex values.
 *
 * BlockNote's built-in `textColor` style only renders colors for its own
 * named default palette; any other value (e.g. `#27ae60`) is stored but not
 * displayed because there is no matching CSS rule. This override applies the
 * color inline, so hex / rgb / css-name values work immediately.
 */
export const textColorStyleSpec = createReactStyleSpec(
	{
		type: "textColor",
		propSchema: "string",
	},
	{
		render: ({ value, contentRef }) => {
			const color = resolveTextColor(value)
			return <span ref={contentRef} style={color ? { color } : undefined} />
		},
	},
)
