import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import "src/infra/fastify-augment.ts"

import { createResourceService } from "./service.ts"
import { buildResourceUploads } from "./upload.ts"

let uploadWarmCover: ((id: string) => void) | undefined

async function resPluginImpl(app: FastifyInstance): Promise<void> {
	const uploads = buildResourceUploads(
		app.paths,
		{
			maxArchiveExtractedBytes: app.env.MAX_ARCHIVE_EXTRACTED_BYTES,
		},
		app.runtimeRefs.readOnly,
	)
	app.decorate("resUploads", uploads)

	app.decorate("registerUploadWarmCover", (fn: (id: string) => void) => {
		uploadWarmCover = fn
	})

	const createService = () =>
		createResourceService({
			db: app.db,
			paths: app.paths,
			readOnly: app.runtimeRefs.readOnly,
			uploads,
			pluginHooks: app.pluginHooks,
			maxPluginExtractBytes: app.env.MAX_PLUGIN_EXTRACT_BYTES,
			maxPluginExtractEntries: app.env.MAX_PLUGIN_EXTRACT_ENTRIES,
			onMetaUpdated: (id, types, meta) => {
				app.sseBroadcaster.broadcast({
					type: "resourceMetaUpdated",
					resourceId: id,
					metaTypes: types,
					meta,
				})
			},
			onUploadCommitted: (id) => {
				uploadWarmCover?.(id)
			},
			onUserAction: (action) => {
				app.traceService.record(action)
			},
		})
	let current = createService()
	app.decorate(
		"resService",
		new Proxy(current, {
			get(_target, key, receiver) {
				const value: unknown = Reflect.get(current, key, receiver)
				return typeof value === "function" ? value.bind(current) : value
			},
		}),
	)
	app.storageReloadHandlers?.push(async () => {
		await current.drainMetaQueue()
		current = createService()
	})
}

export const resPlugin = fp(resPluginImpl satisfies FastifyPluginAsync, {
	name: "resource-plugin",
	dependencies: [
		"db-plugin",
		"paths-plugin",
		"content-plugin-domain",
		"trace-plugin",
	],
})
