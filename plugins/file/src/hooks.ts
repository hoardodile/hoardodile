import { definePluginAPI } from "@hoardodile/sdk-react"
import type { FileSchema } from "./shared"

export const { PluginAPIProvider, usePluginAPI } = definePluginAPI<FileSchema>()
