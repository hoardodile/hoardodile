import "src/infra/fastify-augment.ts"
import { createAdaptiveConcurrency } from "src/infra/adaptive-concurrency.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createThumbService } from "./service.ts"

export const thumbPlugin = buildServicePlugin({
	name: "thumb-plugin",
	serviceKey: "thumbService",
	createService: (app) => {
		const thumbs = createThumbService({
			paths: app.paths,
			resources: app.resService,
			probeCache: app.resService.probeCache,
			concurrency: createAdaptiveConcurrency(),
		})
		app.registerUploadWarmCover((id) => {
			// Post-upload cover flow: warm the cover thumb, then record
			// coverMeta from the rendered thumb through the unified writer
			// (fast path — dims read back from the render, no source
			// re-probe). When the render is unavailable, fall back to the
			// probe-based rebuild so clients still receive a
			// resourceMetaUpdated event carrying coverMeta. This is why the
			// upload commit only enqueues fileStats+pluginMeta (see
			// finalizeUploadCommit in domain/res/service.ts).
			void thumbs
				.getCover(id)
				.then(async (cover) => {
					if (cover.kind === "ready") {
						await app.resService.recordCoverMetaFromRenderedThumb(
							id,
							cover.path,
						)
					} else {
						await app.resService.rebuildCoverMeta(id)
					}
				})
				.catch((err) => {
					app.log.warn({ err, id }, "upload cover warm failed")
				})
		})
		return thumbs
	},
	dependencies: ["paths-plugin", "resource-plugin"],
})
