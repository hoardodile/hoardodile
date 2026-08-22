import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createResourceCollectionService } from "./service.ts"

export const resCollectionPlugin = buildServicePlugin({
	name: "resource-collection-plugin",
	serviceKey: "resCollectionService",
	createService: (app) => createResourceCollectionService({ db: app.db }),
	dependencies: ["db-plugin"],
})
