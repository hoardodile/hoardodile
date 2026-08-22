import { requestSchemas } from "@hoardodile/host-web"
import { pluginMethods } from "@hoardodile/sdk-web"
import type { QueryClient } from "@tanstack/react-query"
import { invalidateComments } from "@/features/comments"
import { danmakuKeys } from "@/features/danmaku/api"
import { pushInvalidated } from "@/features/plugin/iframe/pushes"
import { invalidateResources } from "@/features/res/api"
import { defineHandler, type HostHandlerEntry } from "./registry"

export function createHandlers(qc: QueryClient): HostHandlerEntry[] {
	return [
		defineHandler(
			pluginMethods.invalidate,
			requestSchemas[pluginMethods.invalidate],
			async (ctx, params) => {
				const target = params.target
				switch (target) {
					case "resource":
					case "resources":
						await invalidateResources(qc)
						break
					case "messages":
						await invalidateComments(qc)
						break
					case "danmaku":
						await qc.invalidateQueries({
							predicate: (query) => {
								const key = query.queryKey
								if (key[0] !== danmakuKeys.all[0] || key[1] !== "list")
									return false
								const input = key[2] as
									| { anchor: { resId: string } }
									| undefined
								return input?.anchor?.resId === ctx.resId
							},
						})
						break
				}
				// Notify plugin iframes so their query hooks refetch — this
				// completes the `*:invalidate` push link (see pushes.ts).
				pushInvalidated(ctx.resId, target)
			},
		),
	]
}
