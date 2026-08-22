import type { ReactivePluginAPI, WebPluginAPI } from "@hoardodile/sdk-web"
import { createContext, useContext } from "react"

/**
 * The full plugin API as delivered to React plugin components: the
 * imperative {@link WebPluginAPI} plus the reactive hooks implemented by
 * this package's adapter. Typed with default (unknown) schema slots; the
 * typed provider from `definePluginAPI` narrows it per plugin.
 */
export type BasePluginAPI = WebPluginAPI & ReactivePluginAPI

export const PluginAPIContext = createContext<BasePluginAPI | null>(null)

/**
 * Provides the plugin API to the component tree. Usually created
 * implicitly via {@link createPluginRoot}; the typed provider from
 * {@link definePluginAPI} narrows `BasePluginAPI` to the plugin's
 * schema.
 */
export const PluginAPIProvider = PluginAPIContext.Provider

export function usePluginAPI(): BasePluginAPI {
	const api = useContext(PluginAPIContext)
	if (api === null) {
		throw new Error("usePluginAPI must be used within a PluginAPIProvider")
	}
	return api
}
