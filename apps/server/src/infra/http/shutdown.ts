import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import {
	authorizeSidecarToken,
	isLoopbackRequest,
} from "src/infra/http/internal-token.ts"
import "src/infra/fastify-augment.ts"

export type ShutdownPluginOpts = {
	readonly onAuthorized?: () => void | Promise<void>
}

/**
 * Token-gated loopback shutdown for the desktop sidecar. Windows
 * `child.kill()` cannot deliver SIGTERM, so the shell POSTs here, waits
 * for the process to exit, and only then force-kills.
 *
 * Wrong or missing token: 401, Fastify stays up. On match: 200, then the
 * authorized callback (default: `app.close()` and `process.exit(0)`).
 */
async function shutdownPluginImpl(
	app: FastifyInstance,
	opts: ShutdownPluginOpts,
): Promise<void> {
	let shuttingDown = false

	app.post("/api/internal/shutdown", async (request, reply) => {
		if (!isLoopbackRequest(request)) {
			return reply.code(403).send({ ok: false as const })
		}
		if (!authorizeSidecarToken(app, request)) {
			return reply.code(401).send({ ok: false as const })
		}
		if (shuttingDown) {
			return { ok: true as const }
		}
		shuttingDown = true
		await reply.send({ ok: true as const })
		queueMicrotask(() => {
			void runAuthorizedShutdown(app, opts.onAuthorized)
		})
	})
}

async function runAuthorizedShutdown(
	app: FastifyInstance,
	onAuthorized: ShutdownPluginOpts["onAuthorized"],
): Promise<void> {
	if (onAuthorized !== undefined) {
		await onAuthorized()
		return
	}
	try {
		await app.close()
	} finally {
		process.exit(0)
	}
}

export const shutdownPlugin = fp(
	shutdownPluginImpl satisfies FastifyPluginAsync<ShutdownPluginOpts>,
	{
		name: "shutdown-plugin",
		dependencies: ["env-plugin"],
	},
)
