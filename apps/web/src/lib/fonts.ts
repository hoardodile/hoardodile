/**
 * Font registry and dynamic CSS loader.
 *
 * Users pick system fonts or type arbitrary family names. Shipped webfont
 * presets will come back through download/install; until then
 * {@link PRESET_FONTS} is empty so the picker does not list them. Presets
 * that declare a `cssPath` are loaded on demand via `<link>`.
 */

export type FontPreset = {
	readonly id: string
	readonly name: string
	readonly family: string
	readonly cssPath?: string
	readonly i18nKey: string
}

/** The system sans stack, plus CJK fallbacks.
 *  Used as the default app font and by the reset button to quickly
 *  restore a sensible default font-family. */
export const SYSTEM_FONT_TAGS: readonly string[] = [
	"-apple-system",
	"BlinkMacSystemFont",
	"Segoe UI",
	"Roboto",
	"Helvetica Neue",
	"Arial",
	"PingFang SC",
	"Hiragino Sans GB",
	"Microsoft YaHei",
	"sans-serif",
] as const

/** Default documents page font (body + headings): the reading serif
 *  Georgia. */
export const DOC_PAGE_FONT_TAGS: readonly string[] = [
	"Georgia",
	"Times New Roman",
	"serif",
] as const

export const EXTRA_FONT_TAGS: readonly string[] = [
	"Verdana",
	"Georgia",
	"Times New Roman",
	"Courier New",
	"Consolas",
	"Garamond",
	"Trebuchet MS",
	"Songti SC",
	"SimSun",
	"Impact",
	"Comic Sans MS",
	"monospace",
	"serif",
] as const

/** Shipped webfont presets. Empty until download/install lands. */
export const PRESET_FONTS: readonly FontPreset[] = []

const PRESET_BY_ID = new Map<string, FontPreset>()
const PRESET_BY_NAME = new Map<string, FontPreset>()
for (const p of PRESET_FONTS) {
	PRESET_BY_ID.set(p.id, p)
	PRESET_BY_NAME.set(p.name, p)
}

export function getPresetByIdOrName(key: string): FontPreset | undefined {
	return PRESET_BY_ID.get(key) ?? PRESET_BY_NAME.get(key)
}

// ── CSS helpers ────────────────────────────────────────────────────────────

/** Build a CSS `font-family` value from an ordered list of font identifiers. */
export function buildFontFamily(names: readonly string[]): string {
	if (names.length === 0) return ""
	const parts = names.map((n) => getPresetByIdOrName(n)?.family ?? n)
	return parts.join(", ")
}

/** Get the CSS path for a preset font by its id or display name. */
function getPresetCssPath(key: string): string | undefined {
	return getPresetByIdOrName(key)?.cssPath
}

/** Collect the deduped CSS paths backing a list of font identifiers. */
export function collectFontCssPaths(keys: readonly string[]): string[] {
	const seen = new Set<string>()
	for (const key of keys) {
		const path = getPresetCssPath(key)
		if (path !== undefined) seen.add(path)
	}
	return [...seen]
}

/** Load CSS for a preset font if it exists. Idempotent. */
export function loadPresetCss(key: string): void {
	const path = getPresetCssPath(key)
	if (path !== undefined) loadFontCss(path)
}

/** Load multiple preset CSS files. Idempotent per path. */
export function loadPresetCssList(keys: readonly string[]): void {
	for (const path of collectFontCssPaths(keys)) {
		loadFontCss(path)
	}
}

/** Dynamically inject a `<link rel="stylesheet">`. Idempotent. */
export function loadFontCss(path: string): void {
	if (typeof document === "undefined") return
	const selector = `link[rel="stylesheet"][href="${path}"]`
	if (document.querySelector(selector) !== null) return
	const link = document.createElement("link")
	link.rel = "stylesheet"
	link.href = path
	document.head.appendChild(link)
}
