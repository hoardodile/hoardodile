import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createTagService } from "./service.ts"

export const tagPlugin = buildServicePlugin({
	name: "tag-plugin",
	serviceKey: "tagService",
	createService: (app) => createTagService({ db: app.db }),
	dependencies: ["db-plugin"],
})
