import { requestSchemas } from "@hoardodile/host-web"
import { pluginMethods } from "@hoardodile/sdk-web"
import type { QueryClient } from "@tanstack/react-query"
import { invalidateResources } from "@/features/res/api"
import { apiPutBlob } from "@/lib/http"
import { apiPaths } from "@/lib/paths"
import { defineHandler, type HostHandlerEntry } from "./registry"

/**
 * The resource cover handler (iframe side): uploads the cover of the
 * plugin's bound resource through the credentialed `PUT
 * /api/resources/:id/cover` endpoint, which the sandboxed iframe cannot
 * reach itself (no session cookie). The endpoint requires an
 * `application/octet-stream` body and derives the extension from the
 * `X-Filename` header — not from the MIME type — so this handler always
 * sends octet-stream and forwards the plugin's filename verbatim.
 *
 * On success the resource caches are invalidated so cover tiles/cards
 * refresh; the handler returns the cover path.
 */
export function createHandlers(qc: QueryClient): HostHandlerEntry[] {
	return [
		defineHandler(
			pluginMethods.uploadCover,
			requestSchemas[pluginMethods.uploadCover],
			async (ctx, params) => {
				const blob =
					params.file instanceof Blob ? params.file : new Blob([params.file])
				const res = await apiPutBlob(
					apiPaths.resources.cover(ctx.resId),
					blob,
					params.filename,
					"application/octet-stream",
				)
				if (!res.ok) {
					const text = await res.text().catch(() => "")
					throw new Error(text || `cover upload failed (${res.status})`)
				}
				await invalidateResources(qc, ctx.resId)
				return { path: apiPaths.resources.cover(ctx.resId) }
			},
		),
	]
}
