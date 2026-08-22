import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createSyncService } from "./service.ts"

export const syncPlugin = buildServicePlugin({
	name: "sync-plugin",
	serviceKey: "syncService",
	createService: (app) =>
		createSyncService({
			db: app.db,
			storageService: app.storageService,
		}),
	dependencies: ["db-plugin", "storage-plugin"],
})
