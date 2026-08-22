import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createUsageService } from "./service.ts"

export const usagePlugin = buildServicePlugin({
	name: "usage-plugin",
	serviceKey: "usageService",
	createService: (app) =>
		createUsageService({
			db: app.db,
			resService: app.resService,
			charService: app.charService,
			docService: app.docService,
		}),
	dependencies: [
		"db-plugin",
		"resource-plugin",
		"character-plugin",
		"document-plugin",
	],
})
