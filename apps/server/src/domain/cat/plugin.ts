import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createCategoryService } from "./service.ts"

export const catPlugin = buildServicePlugin({
	name: "category-plugin",
	serviceKey: "catService",
	createService: (app) => createCategoryService({ db: app.db }),
	dependencies: ["db-plugin"],
})
