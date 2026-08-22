import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createDanmakuService } from "./service.ts"

export const danmakuPlugin = buildServicePlugin({
	name: "danmaku-plugin",
	serviceKey: "danmakuService",
	createService: (app) =>
		createDanmakuService({
			db: app.db,
			getRegistry: () => app.pluginLoader.getRegistry(),
		}),
	dependencies: ["db-plugin"],
})
