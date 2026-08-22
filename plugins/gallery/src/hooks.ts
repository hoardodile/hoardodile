import { definePluginAPI } from "@hoardodile/sdk-react"
import { decodeVideoTimeAnchor, type GallerySchema } from "./shared"

export const { PluginAPIProvider, usePluginAPI, useAnchorJump } =
	definePluginAPI<GallerySchema>({ decodeAnchor: decodeVideoTimeAnchor })
