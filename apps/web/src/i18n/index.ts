import type { SupportedLanguage } from "@hoardodile/shared/i18n"
import en from "@hoardodile/shared/i18n/en.json"
import zh from "@hoardodile/shared/i18n/zh.json"
import type { TFunction } from "i18next"
import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"

export const SUPPORTED_LANGUAGES = ["en", "zh"] as const
export type { SupportedLanguage }

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

// Type-check `t()` keys against the en catalog. A wrong key (typo or a key
// added to one catalog but not the other) becomes a compile error instead
// of a silently rendered key name.
declare module "i18next" {
	interface CustomTypeOptions {
		defaultNS: "translation"
		resources: { translation: typeof en }
		returnNull: false
		returnEmptyString: false
	}
}

const storedLang = prefSync.get(prefKeys.language)
const initialLang =
	storedLang && SUPPORTED_LANGUAGES.includes(storedLang as SupportedLanguage)
		? storedLang
		: undefined

i18n.use(initReactI18next).init({
	resources: {
		en: { translation: en },
		zh: { translation: zh },
	},
	lng: initialLang,
	fallbackLng: "en",
	supportedLngs: [...SUPPORTED_LANGUAGES],
	nonExplicitSupportedLngs: true,
	interpolation: { escapeValue: false },
	returnNull: false,
	returnEmptyString: false,
	compatibilityJSON: "v4",
	pluralSeparator: "_",
	detection: {
		order: ["navigator", "htmlTag"],
		caches: [],
	},
})

export { i18n }
export default i18n
