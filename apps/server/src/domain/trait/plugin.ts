import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createTraitService } from "./service.ts"

export const traitPlugin = buildServicePlugin({
	name: "trait-plugin",
	serviceKey: "traitService",
	createService: (app) => createTraitService({ db: app.db }),
	dependencies: ["db-plugin"],
})
