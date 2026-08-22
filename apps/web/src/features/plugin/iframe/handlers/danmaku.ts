import { requestSchemas } from "@hoardodile/host-web"
import type { DanmakuMode } from "@hoardodile/schemas"
import type { DanmakuListFilter } from "@hoardodile/sdk-web"
import { pluginMethods } from "@hoardodile/sdk-web"
import type { QueryClient } from "@tanstack/react-query"
import { trpcMutate, trpcQuery } from "@/trpc/factory"
import { defineHandler, type HostHandlerEntry } from "./registry"

export function createHandlers(_qc: QueryClient): HostHandlerEntry[] {
	return [
		defineHandler(
			pluginMethods.listDanmaku,
			requestSchemas[pluginMethods.listDanmaku],
			async (ctx, params) => {
				const rows = await trpcQuery("danmaku", "list", {
					anchor: { resId: ctx.resId },
				})
				const filter = params.filter
				if (filter === undefined) return rows
				return rows.filter((d) => matchesDanmakuFilter(d.anchor.data, filter))
			},
		),

		defineHandler(
			pluginMethods.createDanmaku,
			requestSchemas[pluginMethods.createDanmaku],
			async (ctx, params) => {
				return trpcMutate("danmaku", "create", {
					text: params.text,
					// Strip any plugin-supplied resId; the resource always
					// comes from the iframe's own binding.
					anchor: { data: params.anchor.data },
					anchorResId: ctx.resId,
					mode: params.mode as DanmakuMode,
				})
			},
		),
	]
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return value !== null && typeof value === "object" && !Array.isArray(value)
}

/**
 * Matches a danmaku against the plugin-declared filter: every declared
 * field must equal the value stored under the same key in the anchor's
 * `data`. Danmaku without matching data (or without data at all) are
 * excluded whenever a filter is set — e.g. another file's danmaku must
 * not render during playback of the current one.
 */
function matchesDanmakuFilter(
	data: unknown,
	filter: DanmakuListFilter,
): boolean {
	if (!isRecord(data)) return false
	for (const [key, value] of Object.entries(filter)) {
		if (value !== undefined && data[key] !== value) return false
	}
	return true
}
