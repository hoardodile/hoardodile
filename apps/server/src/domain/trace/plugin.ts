import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createTraceService } from "./service.ts"

/**
 * Registers `app.traceService` (the user-footprint event log). Declares no
 * domain dependencies; `resource-plugin` depends on it and wires the
 * `onUserAction` callback at the composition root.
 */
export const tracePlugin = buildServicePlugin({
	name: "trace-plugin",
	serviceKey: "traceService",
	createService: (app) => createTraceService({ db: app.db }),
	dependencies: ["db-plugin"],
})
