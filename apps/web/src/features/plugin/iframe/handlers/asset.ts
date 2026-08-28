import { requestSchemas } from "@hoardodile/host-web"
import { pluginMethods } from "@hoardodile/sdk-web"
import type { QueryClient } from "@tanstack/react-query"
import { enqueueDownloadConsent } from "@/features/plugin/download/consent-store"
import { trpcMutate, trpcQuery } from "@/trpc/factory"
import { defineHandler, type HostHandlerEntry } from "./registry"

/** How often the requesting tab re-checks the broker's pending tickets. */
const CONSENT_POLL_MS = 1_000

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
					return await withConsentWatch(ctx.pluginId, () =>
						trpcMutate("pluginAsset", "request", {
							pluginId: ctx.pluginId,
							items: Array.isArray(params) ? params : [params],
						}),
					)
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

/**
 * Run the download request while watching the broker's pending tickets:
 * the shared consent dialog is normally fed by the `pluginDownloadRequested`
 * SSE broadcast, but a momentarily down stream (server restart, HMR,
 * reconnect backoff) would leave the dialog hidden until the next
 * reconnect's `listPending` rehydration — up to 30 s later. This tab made
 * the request, so it polls `pluginAsset.listPending` for the plugin's
 * tickets until the request settles and surfaces them through the same
 * consent store. `enqueueDownloadConsent` is idempotent per ticketId, so
 * a later SSE delivery (or another poll tick) is a no-op, and every exit
 * path still closes the entry (decide success / resolved broadcast / a
 * decided server no-op).
 */
async function withConsentWatch<T>(
	pluginId: string,
	run: () => Promise<T>,
): Promise<T> {
	let timer: ReturnType<typeof setInterval> | undefined
	async function poll(): Promise<void> {
		try {
			const pending = await trpcQuery("pluginAsset", "listPending")
			for (const ticket of pending) {
				if (ticket.pluginId === pluginId) {
					enqueueDownloadConsent(ticket)
				}
			}
		} catch {
			// Transient failure — the next tick tries again.
		}
	}
	void poll()
	timer = setInterval(() => void poll(), CONSENT_POLL_MS)
	try {
		return await run()
	} finally {
		if (timer !== undefined) clearInterval(timer)
	}
}
