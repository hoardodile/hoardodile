import { createPluginTranslation } from "@hoardodile/sdk-react"
import de from "./locales/de"
import en from "./locales/en"
import es from "./locales/es"
import ja from "./locales/ja"
import zh from "./locales/zh"

/**
 * Plugin UI strings, one bundle per hoardodile-supported language (see
 * `@hoardodile/i18n` — en, zh, ja, de, es). The host's current language is
 * picked automatically and follows `languageChanged` pushes; a language
 * the plugin misses falls back to English.
 */
const { useTranslation } = createPluginTranslation({ en, zh, ja, de, es })

export { useTranslation }
