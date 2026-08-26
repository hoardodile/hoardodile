import { SOLAR_GLYPH_NAMES } from "./solar-names.generated"

/**
 * Solar glyph name normalization for manifest/template icons.
 *
 * The manifest and template grammar accepts a **Solar glyph name** (see
 * `skills/hd-plugin-design` — icons are Solar-only) in either spelling:
 *
 * - kebab as shipped by the package (`video-frame`);
 * - PascalCase as used by the legacy template whitelist (`VideoFrame`).
 *
 * The legacy whitelist names that do NOT derive from their Solar kebab
 * counterpart (the icon's own alias names in `ICON_REGISTRY`) are mapped
 * explicitly so existing manifests keep rendering the same glyph. The
 * output is still only meaningful when {@link isSolarGlyphName} agrees:
 * the renderer renders nothing for names outside the generated index.
 */

/**
 * Legacy whitelist name → Solar kebab glyph. Derived names are handled by
 * the PascalCase conversion; only these diverge.
 */
const LEGACY_ICON_ALIASES: Readonly<Record<string, string>> = {
	Files: "file",
	Film: "video-frame",
	Image: "gallery",
	Info: "info-circle",
	Music: "music-notes",
	Search: "magnifier",
	Sparkle: "star",
	Video: "video-frame",
}

/**
 * Normalize a raw icon name to Solar kebab-case, or `undefined` when the
 * string cannot name a glyph at all (schemes, separators, punctuation).
 * This is syntax only — membership is {@link isSolarGlyphName}.
 */
export function normalizeSolarGlyphName(raw: string): string | undefined {
	const trimmed = raw.trim()
	if (trimmed.length === 0) return undefined
	const aliased = LEGACY_ICON_ALIASES[trimmed]
	if (aliased !== undefined) return aliased
	if (/^[a-z][a-z0-9-]*$/.test(trimmed)) return trimmed
	if (/^[A-Za-z][A-Za-z0-9]*$/.test(trimmed)) {
		return trimmed.replace(/([a-z0-9])([A-Z])/g, "$1-$2").toLowerCase()
	}
	return undefined
}

/** True when the raw string names an indexed Solar glyph. */
export function isSolarGlyphName(raw: string): boolean {
	const name = normalizeSolarGlyphName(raw)
	return name !== undefined && SOLAR_GLYPH_NAMES.has(name)
}
