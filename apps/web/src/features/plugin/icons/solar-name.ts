import { normalizeSolarGlyphName } from "@hoardodile/ui/res-card-template"
import { SOLAR_GLYPH_NAMES } from "./solar-names.generated"

/**
 * Solar glyph name normalization for manifest/template icons. The
 * normalization (syntax only) is shared with the res-card template
 * renderer and lives in `@hoardodile/ui/res-card-template`; this module
 * re-exports it and adds the generated-index membership check the app's
 * icon renderer needs.
 */
export { normalizeSolarGlyphName }

/** True when the raw string names an indexed Solar glyph. */
export function isSolarGlyphName(raw: string): boolean {
	const name = normalizeSolarGlyphName(raw)
	return name !== undefined && SOLAR_GLYPH_NAMES.has(name)
}
