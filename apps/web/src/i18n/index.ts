import i18n from "i18next"
import { initReactI18next } from "react-i18next"
import { prefKeys } from "@/lib/keys"
import { prefSync } from "@/lib/prefSync"
import en from "./en.json"
import zh from "./zh.json"

export const SUPPORTED_LANGUAGES = ["en", "zh"] as const
export type SupportedLanguage = (typeof SUPPORTED_LANGUAGES)[number]

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
	detection: {
		order: ["navigator", "htmlTag"],
		caches: [],
	},
})

export { i18n }
export default i18n
