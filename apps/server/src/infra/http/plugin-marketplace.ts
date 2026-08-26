import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import { z } from "zod"
import { domainErrorToHttp, sendError } from "./utils.ts"

const installInput = z.object({
	/** App manifest id — the zip must carry the same id (no half-installs). */
	id: z.string().uuid(),
	/** Release asset download URL (`github.com` release-download family). */
	assetUrl: z.string().min(1).max(2_000),
	/** Optional sha256 from the release's `<asset>.sha256` sidecar. */
	sha256: z
		.string()
		.regex(/^[0-9a-fA-F]{64}$/, "sha256 must be 64 hex chars")
		.optional(),
})

/**
 * Marketplace install/update endpoint.
 *
 * HTTP, not tRPC: the request downloads (and the server validates) a full
 * plugin zip — the tRPC client's 15 s ceiling does not apply here, same
 * as the local zip upload (`POST /api/plugin-upload`).
 *
 * Auth + read-only gating are inherited from `protectedHttpPlugin` — the
 * route is intentionally not marked `readOnlySafe`, so it is 403 while
 * viewing a past archive version.
 */
async function pluginMarketplacePluginImpl(
	app: FastifyInstance,
): Promise<void> {
	app.post("/api/plugin-marketplace/install", async (req, reply) => {
		const parsed = installInput.safeParse(req.body)
		if (!parsed.success) {
			return sendError(
				reply,
				400,
				"invalid request body",
				"marketplace.install_invalid",
			)
		}
		try {
			const { pluginId } = await app.marketplaceService.install(parsed.data)
			return reply.send({ pluginId })
		} catch (err) {
			return domainErrorToHttp(reply, err)
		}
	})
}

export const pluginMarketplacePlugin =
	pluginMarketplacePluginImpl satisfies FastifyPluginAsync
