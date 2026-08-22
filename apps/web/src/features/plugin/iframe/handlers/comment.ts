import { requestSchemas } from "@hoardodile/host-web"
import { pluginMethods } from "@hoardodile/sdk-web"
import type { QueryClient } from "@tanstack/react-query"
import { trpcMutate, trpcQuery } from "@/trpc/factory"
import { defineHandler, type HostHandlerEntry } from "./registry"

export function createHandlers(_qc: QueryClient): HostHandlerEntry[] {
	return [
		defineHandler(pluginMethods.listMessages, async (ctx) => {
			const r = await trpcQuery("comment", "list", { resId: ctx.resId })
			return r.rows
		}),

		defineHandler(
			pluginMethods.createMessage,
			requestSchemas[pluginMethods.createMessage],
			async (ctx, params) => {
				// The anchor's resource is forced to the iframe's own
				// resource — a plugin-supplied resId is stripped, never
				// trusted. The server merges the resource into the
				// comment's resIds.
				const anchor =
					params.anchor === undefined ? undefined : { data: params.anchor.data }
				return trpcMutate("comment", "create", {
					body: params.body,
					anchor,
					anchorResId: ctx.resId,
				})
			},
		),
	]
}
