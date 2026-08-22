import { createPluginTranslation } from "@hoardodile/sdk-react"
import en from "./locales/en"
import zh from "./locales/zh"

const { useTranslation } = createPluginTranslation({ en, zh })

export { useTranslation }
