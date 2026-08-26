import type { FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
// Single side-effect import that brings every `FastifyInstance`
// augmentation (infra primitives + service container) into the type
// graph for files that transitively import this barrel.
import "src/infra/fastify-augment.ts"
import { catPlugin } from "./cat/plugin.ts"
import { charPlugin } from "./char/plugin.ts"
import { resCollectionPlugin } from "./col/plugin.ts"
import { commentPlugin } from "./comment/plugin.ts"
import { danmakuPlugin } from "./danmaku/plugin.ts"
import { docPlugin } from "./doc/plugin.ts"
import { marketplacePlugin } from "./marketplace/plugin.ts"
import { pluginDomain } from "./plugin/plugin.ts"
import { prefPlugin } from "./prefs/plugin.ts"
import { resPlugin } from "./res/plugin.ts"
import { searchPlugin } from "./search/plugin.ts"
import { storagePlugin } from "./storage/plugin.ts"
import { syncPlugin } from "./sync/plugin.ts"
import { tagPlugin } from "./tag/plugin.ts"
import { tracePlugin } from "./trace/plugin.ts"
import { traitPlugin } from "./trait/plugin.ts"
import { usagePlugin } from "./usage/plugin.ts"

/**
 * Aggregate every domain Fastify plugin behind a single registration
 * point, and register the matching tRPC routers on the Fastify instance
 * so {@link buildDomainRouter} can discover them automatically.
 */
async function domainPluginsImpl(app: Parameters<FastifyPluginAsync>[0]) {
	await app.register(pluginDomain)
	await app.register(tracePlugin)
	await app.register(resPlugin)
	await app.register(charPlugin)
	await app.register(docPlugin)
	await app.register(catPlugin)
	await app.register(tagPlugin)
	await app.register(traitPlugin)
	await app.register(resCollectionPlugin)
	await app.register(commentPlugin)
	await app.register(danmakuPlugin)
	await app.register(prefPlugin)
	await app.register(marketplacePlugin)
	await app.register(searchPlugin)
	await app.register(usagePlugin)
	await app.register(storagePlugin)
	await app.register(syncPlugin)
}

export const domainPlugins = fp(
	domainPluginsImpl satisfies FastifyPluginAsync,
	{
		name: "domain-plugins",
		dependencies: ["db-plugin", "paths-plugin"],
	},
)
