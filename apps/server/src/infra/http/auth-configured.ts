import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import { getAuthRow } from "src/domain/auth/repo.ts"
import {
	authorizeSidecarToken,
	isLoopbackRequest,
} from "src/infra/http/internal-token.ts"
import "src/infra/fastify-augment.ts"

/**
 * Whether an admin password is configured (the instance is claimed) and
 * whether it fails the cheap strength check. The desktop shell consults
 * this before enabling local-network sharing: an unclaimed instance must
 * never become reachable from other devices, and a weak password gets an
 * explicit confirmation first.
 *
 * Loopback + token gated like the other control routes; non-loopback
 * peers get 403 even with a valid token.
 */
async function authConfiguredPluginImpl(app: FastifyInstance): Promise<void> {
	app.get("/api/internal/auth-configured", async (request, reply) => {
		if (!isLoopbackRequest(request)) {
			return reply.code(403).send({ ok: false as const })
		}
		if (!authorizeSidecarToken(app, request)) {
			return reply.code(401).send({ ok: false as const })
		}
		const auth = getAuthRow(app.hostDb ?? app.db)
		return {
			configured: auth !== undefined,
			weakPassword: auth?.weakPassword ?? false,
		}
	})
}

export const authConfiguredPlugin = fp(
	authConfiguredPluginImpl satisfies FastifyPluginAsync,
	{
		name: "auth-configured-plugin",
		dependencies: ["env-plugin", "db-plugin"],
	},
)
