import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import "src/infra/fastify-augment.ts"
import { createMarketplaceService } from "./service.ts"

async function marketplacePluginImpl(app: FastifyInstance): Promise<void> {
	app.decorate(
		"marketplaceService",
		createMarketplaceService({
			prefs: app.systemPrefService,
			fetcher: app.pluginDownloader,
			installer: app.pluginUploads,
			rescan: () => app.pluginService.rescan(),
			tmpDir: app.paths.local.tmp(),
			maxInstallBytes: app.env.PLUGIN_UPLOAD_MAX_BYTES,
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
