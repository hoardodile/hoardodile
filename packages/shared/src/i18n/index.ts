/**
 * Locales the app ships; mirrored by the web i18n bootstrapping.
 *
 * `en.json` and `zh.json` must stay in lockstep: identical flat key sets,
 * matching interpolation placeholders, and complete `_one`/`_other` pairs.
 * `packages/shared/src/i18n/parity.test.ts` enforces this — run it after
 * touching either catalog.
 */
export const SUPPORTED_LANGUAGES = ["en", "zh"] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

/**
 * English fallback for the close-confirm dialog before the SPA has pushed
 * the user's language (first run / SPA never loaded). Mirrors
 * `me.desktop.closeConfirm.*` + `common.cancel` in the i18n catalogs.
 */
export const DEFAULT_CLOSE_DIALOG_STRINGS = {
	title: "Close hoardodile?",
	description: "The app keeps running in the tray unless you quit it.",
	tray: "Hide to tray",
	quit: "Quit the app",
	cancel: "Cancel",
	remember: "Remember my choice",
} as const

/** All close-dialog string keys present in the catalogs. */
export const CLOSE_DIALOG_STRING_KEYS = [
	"title",
	"description",
	"tray",
	"quit",
	"cancel",
	"remember",
] as const

export function isSupportedLanguage(value: string): value is SupportedLanguage {
	return (SUPPORTED_LANGUAGES as readonly string[]).includes(value)
}
