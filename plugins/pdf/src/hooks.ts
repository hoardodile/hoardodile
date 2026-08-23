import { definePluginAPI } from "@hoardodile/sdk-react"
import { decodeAnchor } from "./anchor"
import type { PdfSchema } from "./shared"

export const { PluginAPIProvider, usePluginAPI, useAnchorJump } =
	definePluginAPI<PdfSchema>({ decodeAnchor })
