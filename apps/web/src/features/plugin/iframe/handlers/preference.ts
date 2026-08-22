import { requestSchemas } from "@hoardodile/host-web"
import { pluginMethods } from "@hoardodile/sdk-web"
import type { QueryClient } from "@tanstack/react-query"
import {
	pushCacheChanged,
	pushPrefsChanged,
} from "@/features/plugin/iframe/pushes"
import { trpcMutate } from "@/trpc/factory"
import { defineHandler, type HostHandlerEntry } from "./registry"

export function createHandlers(_qc: QueryClient): HostHandlerEntry[] {
	return [
		defineHandler(
			pluginMethods.setPref,
			requestSchemas[pluginMethods.setPref],
			async (ctx, params) => {
				await trpcMutate("pluginPreference", "set", {
					pluginId: ctx.pluginId,
					key: params.key,
					value: params.value,
				})
				pushPrefsChanged({ key: params.key, value: params.value })
			},
		),

		defineHandler(
			pluginMethods.setCache,
			requestSchemas[pluginMethods.setCache],
			async (ctx, params) => {
				// A write from a never-bound iframe has nowhere to land —
				// drop it silently instead of failing the mutation.
				if (ctx.resId === "") return
				await trpcMutate("pluginPreference", "cacheSet", {
					pluginId: ctx.pluginId,
					resId: ctx.resId,
					key: params.key,
					value: params.value,
				})
				pushCacheChanged({
					resId: ctx.resId,
					key: params.key,
					value: params.value,
				})
			},
		),
	]
}
