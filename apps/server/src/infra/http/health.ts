import type { FastifyInstance, FastifyPluginAsync } from "fastify"
import fp from "fastify-plugin"
import "src/infra/fastify-augment.ts"
import { volumeStatsOf } from "src/infra/disk.ts"

/**
 * Unauthenticated health probe for external monitoring scripts. Only
 * aggregates are exposed (volume totals and complete-backup state) —
 * never absolute paths or per-entity data. Registered outside the
 * session-gated HTTP scope on purpose.
 */
async function healthPluginImpl(app: FastifyInstance): Promise<void> {
	app.get("/api/health", async () => {
		const volume = await volumeStatsOf(app.paths.root)
		const protection = app.protectionService.getStatus()
		return {
			status: "ok",
			storage: volume ?? null,
			backup: {
				configured: protection.repositories.some(
					(entry) => entry.id === "local",
				),
				automatic: protection.enabled,
				lastBackupAt: protection.lastBackupAt,
			},
		}
	})
}

export const healthPlugin = fp(healthPluginImpl satisfies FastifyPluginAsync, {
	name: "health-plugin",
	dependencies: ["env-plugin", "db-plugin", "paths-plugin"],
})
