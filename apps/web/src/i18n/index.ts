import {
	createI18n,
	isSupportedLanguage,
	resolveSystemLanguage,
	SUPPORTED_LANGUAGES,
	type SupportedLanguage,
} from "@hoardodile/i18n"
import type { TFunction } from "i18next"
import { setI18n } from "react-i18next"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"

export type { SupportedLanguage }
export { isSupportedLanguage, resolveSystemLanguage, SUPPORTED_LANGUAGES }

/** Typed translate function (`t` from `useTranslation`), for helpers that
 *  receive it as a parameter and call it with catalog keys. */
export type Translate = TFunction<"translation", undefined>

/** Typed `t` widened for helpers that receive it as a parameter and build
 *  keys dynamically (template literals assembled from data). Use only where
 *  every produced key is known to exist in the catalog — this bypasses key
 *  checking deliberately, so keep the key construction adjacent to a test. */
export type LooseTranslate = (
	key: string,
	opts?: Record<string, unknown>,
) => string

/** Adapter: typed `t` → {@link LooseTranslate} for dynamic-key helpers. */
export function loose(t: Translate): LooseTranslate {
	return t as unknown as LooseTranslate
}

// The i18next instance is created by the shared factory with the same
// options every other surface uses (fallback language, plurals,
// interpolation, the shared `translation` + `ui` catalogs). It is bound
// as react-i18next's default instance for the SPA's own `useTranslation()`
// calls and passed to `@hoardodile/ui` via <I18nProvider> (see main.tsx).
//
// The cast bridges pnpm's two physical react-i18next copies (the optional
// `typescript` peer splits i18next into one store per toolchain context)
// — the instance object itself is copy-agnostic.
const storedLang = prefSync.get(prefKeys.language)
const initialLang =
	storedLang && isSupportedLanguage(storedLang) ? storedLang : undefined

const i18n = createI18n({ lng: initialLang })
setI18n(i18n as unknown as Parameters<typeof setI18n>[0])

export { i18n }
export default i18n
