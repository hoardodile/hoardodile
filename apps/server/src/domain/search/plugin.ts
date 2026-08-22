import { buildServicePlugin } from "src/infra/plugins.ts"
import { createSearchService, type SearchService } from "./service.ts"

declare module "fastify" {
	interface FastifyInstance {
		readonly searchService: SearchService
	}
}

export const searchPlugin = buildServicePlugin({
	name: "search-plugin",
	serviceKey: "searchService",
	createService: (app) =>
		createSearchService({
			charService: app.charService,
			resService: app.resService,
			docService: app.docService,
			commentService: app.commentService,
		}),
	dependencies: [
		"character-plugin",
		"resource-plugin",
		"document-plugin",
		"comment-plugin",
	],
})
