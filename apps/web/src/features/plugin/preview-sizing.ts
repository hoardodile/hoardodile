import type { PluginManifestUi } from "@hoardodile/sdk-types"
import { useQuery } from "@tanstack/react-query"
import type { CSSProperties } from "react"
import { pluginListAllQueryOptions } from "./pluginApi"

/**
 * Resolves the preview surface sizing a plugin manifest declares, as
 * inline style shared by the preview dialog and the resource detail page:
 * `ui.aspect` wins (capped at `maxHeight`), then a fixed `ui.height`, and
 * finally the host's fallback height when the manifest says nothing.
 */
export function resolvePreviewSizing(
	manifestUi: PluginManifestUi | undefined,
	opts: { readonly maxHeight: string; readonly fallbackHeight: string },
): CSSProperties {
	if (manifestUi?.aspect !== undefined) {
		return { aspectRatio: manifestUi.aspect, maxHeight: opts.maxHeight }
	}
	if (manifestUi?.height !== undefined) {
		return { height: manifestUi.height, maxHeight: manifestUi.height }
	}
	return { height: opts.fallbackHeight, maxHeight: opts.fallbackHeight }
}

/**
 * Looks up the manifest `ui` block of a content plugin from the shared
 * plugin list query. Nullish plugin ids (e.g. a resource whose type has
 * no plugin) yield no sizing hints.
 */
export function usePluginManifestUi(
	contentPluginId: string | null | undefined,
): PluginManifestUi | undefined {
	const pluginListQuery = useQuery(pluginListAllQueryOptions())
	if (contentPluginId === null || contentPluginId === undefined) {
		return undefined
	}
	return pluginListQuery.data?.find((p) => p.id === contentPluginId)?.manifest
		.ui
}

/**
 * Resolves the display name of a content plugin from the shared plugin
 * list query. Missing plugins are included in that list (with their last
 * known manifest), so the name resolves even after the plugin was
 * uninstalled — which is what the fallback preview banner needs.
 */
export function usePluginName(
	pluginId: string | null | undefined,
): string | undefined {
	const pluginListQuery = useQuery(pluginListAllQueryOptions())
	if (pluginId === null || pluginId === undefined) {
		return undefined
	}
	return pluginListQuery.data?.find((p) => p.id === pluginId)?.manifest.name
}
