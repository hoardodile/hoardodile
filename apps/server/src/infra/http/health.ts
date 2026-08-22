import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import "src/infra/fastify-augment.ts"
import { volumeStatsOf } from "src/infra/disk.ts"

/**
 * Unauthenticated health probe for external monitoring scripts. Only
 * aggregates are exposed (volume totals + automatic snapshot state) —
 * never absolute paths or per-entity data. Registered outside the
 * session-gated HTTP scope on purpose.
 */
async function healthPluginImpl(app: FastifyInstance): Promise<void> {
	app.get("/api/health", async () => {
		const [volume, autoSnapshot] = await Promise.all([
			volumeStatsOf(app.paths.root),
			app.backupService.getAutoStatus(),
		])
		return {
			status: "ok",
			storage: volume ?? null,
			autoSnapshot,
		}
	})
}

export const healthPlugin = fp(healthPluginImpl satisfies FastifyPluginAsync, {
	name: "health-plugin",
	dependencies: ["env-plugin", "db-plugin", "paths-plugin", "backup-plugin"],
})
