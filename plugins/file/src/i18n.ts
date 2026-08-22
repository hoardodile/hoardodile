import { createPluginTranslation } from "@hoardodile/sdk-react"
import { en } from "./locales/en"
import { zh } from "./locales/zh"

export const { useTranslation } = createPluginTranslation({
	en,
	zh,
})
