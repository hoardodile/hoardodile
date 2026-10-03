import { requestSchemas } from "@hoardodile/host-web"
import { pluginMethods } from "@hoardodile/sdk-web"
import type { QueryClient, QueryKey } from "@tanstack/react-query"
import {
	pushCacheChanged,
	pushPrefsChanged,
} from "@/features/plugin/iframe/pushes"
import { pluginKeys } from "@/features/plugin/pluginApi"
import type { RouterOutputs } from "@/trpc/client"
import { trpcMutate } from "@/trpc/factory"
import { defineHandler, type HostHandlerEntry } from "./registry"

type Bootstrap = RouterOutputs["plugin"]["previewInitContext"]

/** New owners must hydrate current values even while their save is in flight. */
function updateBootstrapSnapshots(
	qc: QueryClient,
	queryKey: QueryKey,
	field: "prefs" | "cache",
	entry: { key: string; value: string },
): void {
	for (const [key, old] of qc.getQueriesData<Bootstrap>({ queryKey })) {
		if (old === undefined) continue
		const values = { ...old[field] }
		if (entry.value === "") delete values[entry.key]
		else values[entry.key] = entry.value
		// Updating saved values must not extend the age of tokens/assets.
		qc.setQueryData<Bootstrap>(
			key,
			{ ...old, [field]: values },
			{ updatedAt: qc.getQueryState(key)?.dataUpdatedAt },
		)
	}
}

export function createHandlers(qc: QueryClient): HostHandlerEntry[] {
	return [
		defineHandler(
			pluginMethods.setPref,
			requestSchemas[pluginMethods.setPref],
			async (ctx, params) => {
				const queryKey = [...pluginKeys.all, "previewInitContext", ctx.pluginId]
				updateBootstrapSnapshots(qc, queryKey, "prefs", params)
				try {
					await trpcMutate("pluginPreference", "set", {
						pluginId: ctx.pluginId,
						key: params.key,
						value: params.value,
					})
				} catch (error) {
					await qc.invalidateQueries({ queryKey, refetchType: "none" })
					throw error
				}
				pushPrefsChanged({ key: params.key, value: params.value })
			},
		),
		defineHandler(
			pluginMethods.setCache,
			requestSchemas[pluginMethods.setCache],
			async (ctx, params) => {
				if (ctx.resId === "") return
				const queryKey = pluginKeys.previewInitContext(ctx.pluginId, ctx.resId)
				updateBootstrapSnapshots(qc, queryKey, "cache", params)
				try {
					await trpcMutate("pluginPreference", "cacheSet", {
						pluginId: ctx.pluginId,
						resId: ctx.resId,
						key: params.key,
						value: params.value,
					})
				} catch (error) {
					await qc.invalidateQueries({ queryKey, refetchType: "none" })
					throw error
				}
				pushCacheChanged({
					resId: ctx.resId,
					key: params.key,
					value: params.value,
				})
			},
		),
	]
}
