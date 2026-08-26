import { requestSchemas } from "@hoardodile/host-web"
import { pluginMethods } from "@hoardodile/sdk-web"
import type { QueryClient } from "@tanstack/react-query"
import { trpcMutate } from "@/trpc/factory"
import { defineHandler, type HostHandlerEntry } from "./registry"

/**
 * The plugin asset vault handlers (iframe side): `download` awaits the
 * same user-consented server pipeline as main.js hooks (the shared
 * consent dialog is driven by the SSE event, not by this handler) and
 * `deleteAsset` removes vault files — the plugin's own lifecycle call.
 *
 * Server rejections carry the machine-readable name via
 * `data.assetError`; it is forwarded to plugin code as `err.name`
 * (DENIED / UNAVAILABLE / POLICY).
 */
export function createHandlers(_qc: QueryClient): HostHandlerEntry[] {
	return [
		defineHandler(
			pluginMethods.download,
			requestSchemas[pluginMethods.download],
			async (ctx, params) => {
				try {
					// The wire accepts a single request or a batch; the
					// server always answers with the result array, and the
					// SDK unwraps the single case (see sdk-web runtime).
					return await trpcMutate("pluginAsset", "request", {
						pluginId: ctx.pluginId,
						items: Array.isArray(params) ? params : [params],
					})
				} catch (err) {
					throw withAssetErrorName(err)
				}
			},
		),
		defineHandler(
			pluginMethods.deleteAsset,
			requestSchemas[pluginMethods.deleteAsset],
			async (ctx, params) => {
				try {
					return await trpcMutate("pluginAsset", "delete", {
						pluginId: ctx.pluginId,
						path: params.path,
					})
				} catch (err) {
					throw withAssetErrorName(err)
				}
			},
		),
	]
}

/** Re-throw a tRPC error with the asset error name preserved. */
function withAssetErrorName(err: unknown): never {
	const data = (err as { data?: { errorCode?: unknown; assetError?: unknown } })
		.data
	const name = data?.errorCode ?? data?.assetError
	if (name === "DENIED" || name === "UNAVAILABLE" || name === "POLICY") {
		const e = new Error(err instanceof Error ? err.message : String(err))
		e.name = name
		throw e
	}
	throw err
}
