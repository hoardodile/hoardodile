import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import "src/infra/fastify-augment.ts"
import { createRelationshipService } from "./relationship_service.ts"
import { createCharacterService } from "./service.ts"

async function charPluginImpl(app: FastifyInstance): Promise<void> {
	app.decorate(
		"charService",
		createCharacterService({
			db: app.db,
			paths: app.paths,
			readOnly: app.runtimeRefs.readOnly,
			onUserAction: (action) => {
				app.traceService.record(action)
			},
		}),
	)
	app.decorate("relationshipService", createRelationshipService({ db: app.db }))
}

export const charPlugin = fp(charPluginImpl satisfies FastifyPluginAsync, {
	name: "character-plugin",
	dependencies: ["db-plugin", "paths-plugin", "trace-plugin"],
})
