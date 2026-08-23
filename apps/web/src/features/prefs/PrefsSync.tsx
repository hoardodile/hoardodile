import { pluginThemePalettes } from "@hoardodile/sdk-web"
import { useEffect, useRef } from "react"
import { useTranslation } from "react-i18next"
import { type ThemePalette, useTheme } from "@/components/common/ThemeProvider"
import { pushLanguageChanged } from "@/features/plugin/iframe/pushes"
import { usePrefSync } from "@/hooks/usePrefSync"
import { isSupportedLanguage, resolveSystemLanguage } from "@/i18n"
import { prefKeys } from "@/lib/keys"
import { plainStringCodec } from "./codecs"

type Theme = "light" | "dark" | "system"

/**
 * Sync bridge between UI state (theme, palette, language) and prefSync.
 *
 * - When the user changes a setting locally, this component pushes the
 *   new value into prefSync so the server sync queue can mirror it.
 * - When the server sync queue hydrates a different value on startup,
 *   this component applies it back to the UI.
 *
 * The component renders nothing.
 */
export function PrefsSync() {
	return (
		<>
			<ThemePrefSync />
			<PalettePrefSync />
			<LanguagePrefSync />
		</>
	)
}

function ThemePrefSync(): null {
	const { theme, setTheme } = useTheme()
	const [syncedTheme, setSyncedTheme] = usePrefSync<string>(
		prefKeys.theme,
		theme,
		plainStringCodec,
	)

	// Push local changes to prefSync.
	useEffect(
		function pushTheme() {
			if (theme !== syncedTheme) {
				setSyncedTheme(theme)
			}
		},
		[theme],
	)

	// Apply server/hydrated changes to UI.
	useEffect(
		function applyTheme() {
			if (syncedTheme !== theme && isTheme(syncedTheme)) {
				setTheme(syncedTheme)
			}
		},
		[syncedTheme],
	)

	return null
}

function PalettePrefSync(): null {
	const { palette, setPalette } = useTheme()
	const [syncedPalette, setSyncedPalette] = usePrefSync<string>(
		prefKeys.themePalette,
		palette,
		plainStringCodec,
	)

	useEffect(
		function pushPalette() {
			if (palette !== syncedPalette) {
				setSyncedPalette(palette)
			}
		},
		[palette],
	)

	useEffect(
		function applyPalette() {
			if (syncedPalette !== palette && isPalette(syncedPalette)) {
				setPalette(syncedPalette)
			}
		},
		[syncedPalette],
	)

	return null
}

export function LanguagePrefSync(): null {
	const { i18n } = useTranslation()
	const current = resolveSystemLanguage(i18n.resolvedLanguage ?? i18n.language)
	const [syncedLang, setSyncedLang] = usePrefSync<string>(
		prefKeys.language,
		current,
		plainStringCodec,
	)
	const syncedLangRef = useRef(syncedLang)
	syncedLangRef.current = syncedLang
	const isApplyingServerLang = useRef(false)

	// Apply server/hydrated language to i18n. Depend only on syncedLang so
	// a user-initiated change to `current` (e.g. via LanguageSettingsPanel) is
	// not immediately reverted while the prefSync write is still in flight.
	useEffect(
		function applyLanguage() {
			if (!isSupportedLanguage(syncedLang)) return
			if (syncedLang !== current) {
				isApplyingServerLang.current = true
				i18n
					.changeLanguage(syncedLang)
					.catch(() => {})
					.finally(() => {
						isApplyingServerLang.current = false
					})
			}
		},
		[syncedLang, i18n],
	)

	// Push user-initiated language changes to prefSync. We deliberately depend
	// only on `current` so that a server hydration updating `syncedLang` cannot
	// cause us to write the old fallback language back to localStorage.
	useEffect(
		function pushLanguage() {
			if (isApplyingServerLang.current) return
			const target = syncedLangRef.current
			if (!isSupportedLanguage(target)) return
			if (current !== target) {
				setSyncedLang(current)
			}
		},
		[current, setSyncedLang],
	)

	// Keep <html lang> and plugin iframes in sync with the active language.
	useEffect(
		function broadcastLanguage() {
			if (typeof document !== "undefined") {
				document.documentElement.lang = current
			}
			pushLanguageChanged(current)
		},
		[current],
	)

	return null
}

function isTheme(value: unknown): value is Theme {
	return value === "light" || value === "dark" || value === "system"
}

function isPalette(value: unknown): value is ThemePalette {
	if (typeof value !== "string") return false
	for (const candidate of pluginThemePalettes) {
		if (candidate === value) return true
	}
	return false
}
