import { apiFetch } from "@/lib/http"
import { apiPaths } from "@/lib/paths"
import { trpcMutation, trpcQuery, trpcQueryOptions } from "@/trpc/factory"

export const pluginKeys = {
	all: ["plugin"] as const,
	listAll: () => [...pluginKeys.all, "listAll"] as const,
	previewInitContext: (pluginId: string, resId: string) =>
		[...pluginKeys.all, "previewInitContext", pluginId, resId] as const,
	usageCount: (pluginId: string) =>
		[...pluginKeys.all, "usageCount", pluginId] as const,
}

export function pluginListAllQueryOptions() {
	return trpcQueryOptions({
		namespace: "plugin",
		procedure: "listAll",
		input: undefined,
		queryKey: pluginKeys.listAll(),
		staleTime: 10_000,
	})
}

/**
 * Bootstrap payload for a plugin preview (prefs/cache/fileToken), cached
 * briefly so the search dialog's neighbor prefetch, the slot's own
 * bootstrap fetch, and back-and-forth switches all dedupe through
 * TanStack Query. 30s of staleness is safe: pref changes are pushed
 * live to iframes (`pushPrefsChanged`), and the file token is a
 * long-lived signature.
 */
export function previewInitContextQueryOptions(opts: {
	readonly pluginId: string
	readonly resId: string
}) {
	return trpcQueryOptions({
		namespace: "plugin",
		procedure: "previewInitContext",
		input: opts,
		queryKey: pluginKeys.previewInitContext(opts.pluginId, opts.resId),
		staleTime: 30_000,
	})
}

export function pluginUpdateMutation() {
	return trpcMutation("plugin", "update")
}

export function pluginReorderMutation() {
	return trpcMutation("plugin", "reorder")
}

export function pluginRescanMutation() {
	return trpcMutation("plugin", "rescan")
}

/**
 * Number of live resources bound to a plugin. Shown in the uninstall
 * confirmation dialog.
 */
export function pluginUsageCountQueryOptions(pluginId: string) {
	return trpcQueryOptions({
		namespace: "plugin",
		procedure: "usageCount",
		input: { id: pluginId },
		queryKey: pluginKeys.usageCount(pluginId),
		staleTime: 5_000,
	})
}

/** Permanently uninstall a plugin (disk directory + settings row). */
export function pluginUninstallMutation() {
	return trpcMutation("plugin", "uninstall")
}

export function systemPrefRemoveAllMutation() {
	return trpcMutation("systemPreference", "removeAll")
}

export function pluginPrefRemoveAllByPluginMutation() {
	return trpcMutation("pluginPreference", "removeAllByPlugin")
}

export function pluginPrefRemoveAllMutation() {
	return trpcMutation("pluginPreference", "removeAll")
}

export function pluginCacheRemoveAllByPluginMutation() {
	return trpcMutation("pluginPreference", "cacheRemoveAllByPlugin")
}

export function pluginCacheRemoveAllMutation() {
	return trpcMutation("pluginPreference", "cacheRemoveAll")
}

export function pluginCacheListByResId(resId: string) {
	return trpcQuery("pluginPreference", "cacheListByResId", { resId })
}

export async function uploadPlugin(formData: FormData): Promise<void> {
	const resp = await apiFetch(apiPaths.pluginUpload(), {
		method: "POST",
		body: formData,
	})
	if (!resp.ok) {
		const text = await resp.text().catch(() => "")
		throw new Error(text || `plugin upload failed (${resp.status})`)
	}
}
