import type { FastifyInstance, FastifyPluginAsync } from "fastify"

/**
 * `GET /api/events` Server-Sent Events route. Keeps the connection open
 * with heartbeat comments for liveness detection. The heartbeat is handled
 * by `@fastify/sse` (15s interval configured at plugin registration).
 */
async function ssePluginImpl(app: FastifyInstance): Promise<void> {
	app.get(
		"/api/events",
		{ sse: true, config: { readOnlySafe: true } },
		async (_req, reply) => {
			app.sseBroadcaster.addConnection(reply.sse)
			await reply.sse.send({ retry: 3_000, data: "" })
			reply.sse.keepAlive()
			await new Promise<void>((resolve) => {
				reply.sse.onClose(() => resolve())
			})
		},
	)
}

export const ssePlugin = ssePluginImpl satisfies FastifyPluginAsync
