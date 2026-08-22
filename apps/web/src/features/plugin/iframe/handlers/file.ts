import { requestSchemas } from "@hoardodile/host-web"
import { pluginMethods } from "@hoardodile/sdk-web"
import type { QueryClient } from "@tanstack/react-query"
import { resFilesQueryOptions } from "@/features/res/api"
import { apiFetch } from "@/lib/http"
import { apiPaths } from "@/lib/paths"
import { defineHandler, type HostHandlerEntry } from "./registry"

export function createHandlers(qc: QueryClient): HostHandlerEntry[] {
	return [
		defineHandler(
			pluginMethods.readFile,
			requestSchemas[pluginMethods.readFile],
			async (ctx, params) => {
				const rangeHeader = toHttpRangeHeader(params.range)
				const res = await apiFetch(
					apiPaths.resources.files(ctx.resId, params.path),
					rangeHeader === undefined
						? undefined
						: { headers: { Range: rangeHeader } },
				)
				if (!res.ok) throw new Error(`HTTP ${res.status}`)
				return res.arrayBuffer()
			},
		),

		defineHandler(pluginMethods.listFiles, async (ctx) => {
			return qc.fetchQuery(resFilesQueryOptions(ctx.resId))
		}),
	]
}

/**
 * Translate the SDK's half-open byte range (`start` inclusive, `end`
 * exclusive) into an HTTP `Range` header (both ends inclusive).
 * Returns `undefined` for an empty range spec.
 */
function toHttpRangeHeader(
	range:
		| {
				readonly start?: number
				readonly end?: number
		  }
		| undefined,
): string | undefined {
	if (range === undefined) return undefined
	if (range.start !== undefined) {
		return range.end === undefined
			? `bytes=${range.start}-`
			: `bytes=${range.start}-${Math.max(0, range.end - 1)}`
	}
	return range.end === undefined ? undefined : `bytes=-${range.end}`
}
