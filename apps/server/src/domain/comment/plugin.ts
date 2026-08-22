import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createCommentService } from "./service.ts"

export const commentPlugin = buildServicePlugin({
	name: "comment-plugin",
	serviceKey: "commentService",
	createService: (app) =>
		createCommentService({
			db: app.db,
			getRegistry: () => app.pluginLoader.getRegistry(),
			onUserAction: (action) => {
				app.traceService.record(action)
			},
		}),
	dependencies: ["db-plugin", "trace-plugin"],
})
