import { authedProcedure, router, writeProcedure } from "src/infra/trpc/core.ts"
import { z } from "zod"
import type { MarketplaceService } from "./service.ts"

const setConfigInput = z.object({
	/** `null` disables the marketplace (clears the stored registry repo). */
	registryRepo: z.string().max(300).nullable(),
})

const snapshotInput = z.object({
	/** Bypass the server-side cache. */
	force: z.boolean().optional(),
})

export function buildMarketplaceRouter(deps: {
	readonly service: MarketplaceService
}) {
	const { service } = deps
	return router({
		getConfig: authedProcedure.query(() => service.getConfig()),
		setConfig: writeProcedure.input(setConfigInput).mutation(({ input }) => {
			service.setConfig(input.registryRepo)
		}),
		/**
		 * Catalog snapshot: registry + per-plugin manifests + latest
		 * releases. Cached server-side (default window: a day); the UI
		 * loads it on page open and the refresh button forces.
		 */
		snapshot: authedProcedure
			.input(snapshotInput)
			.query(({ input }) => service.refresh(input.force === true)),
	})
}

export type MarketplaceRouter = ReturnType<typeof buildMarketplaceRouter>
