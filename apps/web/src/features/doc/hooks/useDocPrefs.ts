import { useCallback, useMemo } from "react"
import {
	THEME_PALETTES,
	type ThemePalette,
} from "@/components/common/ThemeProvider"
import { booleanCodec, numberCodec } from "@/features/prefs"
import { usePrefSync } from "@/hooks/usePrefSync"
import { prefKeys } from "@/lib/keys"
import { clampZoomIndex, ZOOM_DEFAULT_INDEX } from "../prefs.ts"

const DOC_AUTOSAVE_PREF_KEY = "document.autosave"
// Storage key stays "document.reading" for backward compatibility; the
// mode it backs is now called "preview" (see DocPrefs.previewMode).
const DOC_READING_PREF_KEY = "document.reading"
const DOC_INDENT_PREF_KEY = "document.indent"
const DOC_ZOOM_PREF_KEY = "document.zoom"

export type DocPrefs = {
	readonly autosaveEnabled: boolean
	readonly previewMode: boolean
	readonly indentEnabled: boolean
	readonly fontSizeIndex: number
	readonly toggleAutosave: (onPostFlush: () => void) => void
	readonly togglePreviewMode: (onPostFlush: () => void) => void
	readonly toggleIndent: () => void
	readonly adjustFontSize: (delta: number) => void
	readonly resetFontSize: () => void
	readonly clearTransientDirty: () => void
}

/**
 * Persists the four per-document settings (autosave, preview mode, indent,
 * zoom) through {@link prefSync} so they read instantly from localStorage
 * and sync to the server in the background.
 */
export function useDocumentPrefs(args: {
	readonly clearTransientDirty: () => void
}): DocPrefs {
	const { clearTransientDirty } = args
	const [autosaveEnabled, setAutosave] = usePrefSync(
		DOC_AUTOSAVE_PREF_KEY,
		false,
		booleanCodec(),
	)
	const [previewMode, setPreviewMode] = usePrefSync(
		DOC_READING_PREF_KEY,
		false,
		booleanCodec(),
	)
	const [indentEnabled, setIndentEnabled] = usePrefSync(
		DOC_INDENT_PREF_KEY,
		true,
		booleanCodec(),
	)
	const [fontSizeIndex, setFontSizeIndex] = usePrefSync(
		DOC_ZOOM_PREF_KEY,
		String(ZOOM_DEFAULT_INDEX),
	)

	const zoomIndex = clampZoomIndex(
		Number.parseInt(fontSizeIndex, 10) || ZOOM_DEFAULT_INDEX,
	)

	const toggleAutosave = useCallback(
		function toggleAutosave(onPostFlush: () => void) {
			const next = !autosaveEnabled
			setAutosave(next)
			if (next) onPostFlush()
		},
		[autosaveEnabled, setAutosave],
	)

	const togglePreviewMode = useCallback(
		function togglePreviewMode(onPostFlush: () => void) {
			const next = !previewMode
			if (next) onPostFlush()
			setPreviewMode(next)
			// BlockNote can emit a spurious onChange when its `editable` flag
			// flips. Suppress any pending dirty signal from the transition.
			if (typeof window !== "undefined") {
				window.requestAnimationFrame(clearTransientDirty)
			}
		},
		[previewMode, setPreviewMode, clearTransientDirty],
	)

	const toggleIndent = useCallback(
		function toggleIndent() {
			setIndentEnabled(!indentEnabled)
		},
		[indentEnabled, setIndentEnabled],
	)

	const adjustFontSize = useCallback(
		function adjustFontSize(delta: number) {
			const next = clampZoomIndex(zoomIndex + delta)
			if (next === zoomIndex) return
			setFontSizeIndex(String(next))
		},
		[zoomIndex, setFontSizeIndex],
	)

	const resetFontSize = useCallback(
		function resetFontSize() {
			if (zoomIndex === ZOOM_DEFAULT_INDEX) return
			setFontSizeIndex(String(ZOOM_DEFAULT_INDEX))
		},
		[zoomIndex, setFontSizeIndex],
	)

	return {
		autosaveEnabled,
		previewMode,
		indentEnabled,
		fontSizeIndex: zoomIndex,
		toggleAutosave,
		togglePreviewMode,
		toggleIndent,
		adjustFontSize,
		resetFontSize,
		clearTransientDirty,
	}
}

/** Fixed width slots (px) for the centered reading column. Mirrors the
    design content measures `--container-reading` (680) and
    `--container-medium` (800) in packages/ui/src/styles/theme.css — keep in
    sync; the inline `--doc-reading-width` overrides the column's CSS
    fallback `var(--container-reading)`. */
export const DOC_READING_WIDTHS = [680, 800] as const
export const DOC_READING_WIDTH_DEFAULT = 680

/** Snaps an arbitrary stored number to the nearest valid width slot. */
export function normalizeReadingWidth(value: number): number {
	for (const width of DOC_READING_WIDTHS) {
		if (width === value) return width
	}
	return DOC_READING_WIDTH_DEFAULT
}

/**
 * Reads/writes the reading-column width preference (680/800 px), consumed
 * as the `--doc-reading-width` custom property on the document page.
 */
export function useDocReadingWidth(): {
	readonly readingWidth: number
	readonly setReadingWidth: (width: number) => void
} {
	const [raw, setRaw] = usePrefSync(
		prefKeys.docReadingWidth,
		DOC_READING_WIDTH_DEFAULT,
		numberCodec(),
	)
	const readingWidth = normalizeReadingWidth(raw)

	const setReadingWidth = useCallback(
		function setReadingWidth(width: number) {
			setRaw(normalizeReadingWidth(width))
		},
		[setRaw],
	)

	return { readingWidth, setReadingWidth }
}

export type DocThemePreference = "inherit" | ThemePalette

const DOC_THEME_PREF_KEY = prefKeys.docTheme

function isThemePalette(value: string): value is ThemePalette {
	for (const palette of THEME_PALETTES) {
		if (palette.id === value) return true
	}
	return false
}

function normalizeDocTheme(value: string): DocThemePreference {
	if (value === "inherit") return "inherit"
	if (isThemePalette(value)) return value
	return "parchment"
}

/**
 * Reads the per-document-area theme preference.
 *
 * - `"inherit"` follows the global web theme.
 * - Any registered palette applies that palette locally within the
 *   documents area (and to portaled overlays that re-apply the class).
 *
 * Defaults to `"parchment"` (and normalizes stale values, e.g. the
 * removed `warm-archive`, to it) so the knowledge base keeps its
 * straw-paper look unless the user explicitly opts into another palette.
 */
export function useDocTheme(): {
	readonly theme: DocThemePreference
	readonly themeClass: string | undefined
	readonly setTheme: (theme: DocThemePreference) => void
} {
	const [raw, setRaw] = usePrefSync(DOC_THEME_PREF_KEY, "parchment")
	const theme = useMemo(() => normalizeDocTheme(raw), [raw])

	const themeClass = useMemo(() => {
		if (theme === "inherit") return undefined
		return `theme-${theme}`
	}, [theme])

	const setTheme = useCallback(
		function setTheme(next: DocThemePreference) {
			setRaw(next)
		},
		[setRaw],
	)

	return { theme, themeClass, setTheme }
}
