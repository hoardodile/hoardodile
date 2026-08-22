import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createDocumentService } from "./service.ts"

export const docPlugin = buildServicePlugin({
	name: "document-plugin",
	serviceKey: "docService",
	createService: (app) =>
		createDocumentService({
			db: app.db,
			onUserAction: (action) => {
				app.traceService.record(action)
			},
		}),
	dependencies: ["db-plugin", "trace-plugin"],
})
