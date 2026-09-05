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

const detailInput = z.object({
	/** App manifest id — the only field the asset pick needs. */
	id: z.string().uuid(),
	/** Normalized `owner/repo` of the plugin to inspect. */
	repo: z.string().min(1).max(300),
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
		/**
		 * One plugin's authoritative latest release (asset / notes / readme /
		 * sha256), built on demand when the user opens its view and cached
		 * per repo. Both the catalog snapshot and this detail read only
		 * quota-free GitHub web endpoints, so the marketplace keeps working
		 * even while the GitHub API's 60/hour-per-IP quota is exhausted.
		 */
		detail: authedProcedure
			.input(detailInput)
			.query(({ input }) => service.detail(input.repo, input.id)),
	})
}

export type MarketplaceRouter = ReturnType<typeof buildMarketplaceRouter>
