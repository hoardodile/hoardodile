import fp from "fastify-plugin"
import "src/infra/fastify-augment.ts"
import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import {
	createAsyncPrefService,
	createCacheService,
	createPluginPrefService,
	createSystemPrefService,
} from "./service.ts"

async function prefPluginImpl(app: FastifyInstance): Promise<void> {
	app.decorate("systemPrefService", createSystemPrefService({ db: app.db }))
	app.decorate("asyncPrefService", createAsyncPrefService({ db: app.db }))
	app.decorate("pluginPrefService", createPluginPrefService({ db: app.db }))
	app.decorate("cacheService", createCacheService({ db: app.db }))
}

export const prefPlugin = fp(prefPluginImpl satisfies FastifyPluginAsync, {
	name: "preference-plugin",
	dependencies: ["db-plugin"],
})
