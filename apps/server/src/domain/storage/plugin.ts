import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createStorageService } from "./service.ts"

/**
 * Wire the storage accounting service into the Fastify instance. Plugin
 * display names come from the content-plugin service so the per-plugin
 * breakdown renders human-readable labels.
 */
export const storagePlugin = buildServicePlugin({
	name: "storage-plugin",
	serviceKey: "storageService",
	createService: (app) =>
		createStorageService({
			db: app.db,
			paths: app.paths,
			backupRoot: app.env.BACKUP_ROOT,
			pluginNames: new Map(
				app.pluginService.listAll().map((p) => [p.id, p.manifest.name]),
			),
			lowSpaceThresholdBytes: app.env.MIN_FREE_DISK_BYTES,
		}),
	dependencies: [
		"env-plugin",
		"db-plugin",
		"paths-plugin",
		"content-plugin-domain",
	],
})
