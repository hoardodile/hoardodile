import { join } from "node:path"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import "src/infra/fastify-augment.ts"
import { createMarketplaceService } from "./service.ts"

async function marketplacePluginImpl(app: FastifyInstance): Promise<void> {
	app.decorate(
		"marketplaceService",
		createMarketplaceService({
			prefs: app.systemPrefService,
			sources: {
				recordInstallSource: (id, repo) =>
					app.pluginService.setMarketplaceSource(id, repo),
				listInstallSources: () => app.pluginService.listMarketplaceSources(),
			},
			fetcher: app.pluginDownloader,
			installer: app.pluginUploads,
			rescan: () => app.pluginService.rescan(),
			postInstall: (pluginId) => {
				// Fire-and-forget: the install response never waits for the
				// consent dialog; a failing hook is logged and swallowed.
				void app.pluginHooks.runInstallHook(pluginId).catch((err) => {
					app.log.warn({ pluginId, err }, "post-install plugin hook failed")
				})
			},
			tmpDir: app.paths.local.tmp(),
			maxInstallBytes: app.env.PLUGIN_UPLOAD_MAX_BYTES,
			// Under `local/cache/` so it clears with the cache and
			// survives server restarts — the release payload is built at
			// most once per repo per cache window.
			releaseCacheFile: join(
				app.paths.local.cache(),
				"marketplace-releases.json",
			),
			cacheTtlMs: app.env.MARKETPLACE_CACHE_TTL_MS,
			releaseCacheTtlMs: app.env.MARKETPLACE_RELEASE_CACHE_TTL_MS,
			rateLimitCooldownMs: app.env.MARKETPLACE_RATE_LIMIT_COOLDOWN_MS,
		}),
	)
}

export const marketplacePlugin = fp(
	marketplacePluginImpl satisfies FastifyPluginAsync,
	{
		name: "marketplace-plugin",
		// `content-plugin-domain` owns the hardened downloader + upload
		// pipeline; `preference-plugin` owns the system pref store.
		dependencies: [
			"content-plugin-domain",
			"preference-plugin",
			"paths-plugin",
		],
	},
)
