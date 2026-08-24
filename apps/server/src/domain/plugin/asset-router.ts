import { pluginManifestId } from "@hoardodile/sdk-types/schema"
import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type { PluginAssetService } from "./asset-service.ts"
import type { ConsentBroker } from "./consent.ts"

const requestInput = z.object({
	pluginId: pluginManifestId,
	url: z.string().min(1),
	dest: z.string().min(1),
	sha256: z.string().optional(),
	reason: z.string().optional(),
})

const deleteInput = z.object({
	pluginId: pluginManifestId,
	path: z.string().min(1),
})

const decideInput = z.object({
	ticketId: z.string().min(1),
	approved: z.boolean(),
	/** Remember the plugin for this server session — future downloads skip the dialog. */
	remember: z.boolean().optional(),
})

export type PluginAssetRouterDeps = {
	readonly service: PluginAssetService
	readonly consent: ConsentBroker
}

/**
 * The web-facing half of the plugin asset vault. The iframe host handler
 * calls `request`/`delete`, the consent dialog calls `decide`, and
 * `listPending` rehydrates the dialog store after an SSE reconnect
 * (a broadcast can be lost while the connection was down).
 */
export function buildPluginAssetRouter(deps: PluginAssetRouterDeps) {
	return router({
		/** User-consented download into the plugin's vault (awaits the dialog). */
		request: writeProcedure.input(requestInput).mutation(({ input }) =>
			deps.service.requestDownload(input.pluginId, {
				url: input.url,
				dest: input.dest,
				sha256: input.sha256,
				reason: input.reason,
			}),
		),
		/** Idempotent vault removal (the plugin's own lifecycle decision). */
		delete: writeProcedure
			.input(deleteInput)
			.mutation(({ input }) =>
				deps.service.deleteAsset(input.pluginId, input.path),
			),
		/** Answer a consent ticket from the shared dialog. */
		decide: writeProcedure.input(decideInput).mutation(({ input }) => {
			deps.consent.decide(
				input.ticketId,
				input.approved,
				input.remember ?? false,
			)
		}),
		/** Pending consent tickets (SSE-reconnect rehydration). */
		listPending: authedProcedure.query(() => deps.consent.listPending()),
	})
}

export type PluginAssetRouter = ReturnType<typeof buildPluginAssetRouter>
