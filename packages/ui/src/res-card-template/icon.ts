import type { ReactNode } from "react"

/**
 * A resolved template-icon reference: a Solar glyph name, or an
 * asset image URL derived from a manifest-relative path.
 */
export type IconRef =
	| { readonly kind: "icon"; readonly name: string }
	| { readonly kind: "asset"; readonly url: string }

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
 * This is syntax only — membership in the Solar glyph index is left to
 * the renderer that consumes the name.
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

/**
 * Parse a manifest-level icon string into a render-ready ref.
 *
 *   `<SolarGlyph>`       — Solar glyph name (manifest/template icons are
 *                          Solar-only; PascalCase and the legacy whitelist
 *                          names normalize to the kebab glyph)
 *   `<relative/path>`    — resolved through `buildAssetUrl(pluginId, path)`
 *                          (leading `./` stripped)
 *
 * Empty inputs, schemes (`http(s)`, `data:`), `..`-shaped paths and any
 * string that cannot name a glyph return `undefined`. The renderer treats
 * that as "nothing" — icon resolution never throws.
 */
export function parseIconRef(
	raw: string,
	pluginId: string,
	buildAssetUrl: (pluginId: string, path: string) => string,
): IconRef | undefined {
	const trimmed = raw.trim()
	if (trimmed.length === 0) return undefined
	if (
		trimmed.startsWith("http://") ||
		trimmed.startsWith("https://") ||
		trimmed.startsWith("data:")
	) {
		return undefined
	}
	if (
		trimmed.includes(".") ||
		trimmed.includes("/") ||
		trimmed.includes("\\")
	) {
		const rel = trimmed.replace(/^\.[\\/]/, "")
		if (rel.length === 0 || rel.split("/").includes("..")) return undefined
		return { kind: "asset", url: buildAssetUrl(pluginId, rel) }
	}
	const name = normalizeSolarGlyphName(trimmed)
	if (name === undefined) return undefined
	return { kind: "icon", name }
}

/** How a parsed {@link IconRef} is drawn inside a rendered badge/template. */
export type RenderIcon = (ref: IconRef, className?: string) => ReactNode
