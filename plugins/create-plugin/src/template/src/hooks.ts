import { definePluginAPI } from "@hoardodile/sdk-react"
import type { TemplateSchema } from "./shared"

export const { PluginAPIProvider, usePluginAPI } =
	definePluginAPI<TemplateSchema>()
