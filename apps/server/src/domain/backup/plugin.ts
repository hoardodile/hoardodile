import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createBackupService } from "./service.ts"

/**
 * Wire the {@link BackupService} into the Fastify instance. The live DB
 * file path is read from `app.env.DATABASE_URL` so callers cannot
 * accidentally point backups at a different file than the running database.
 *
 * Depends on version-plugin so the active version can be recorded with
 * each backup for the data-history UI.
 */
export const backupPlugin = buildServicePlugin({
	name: "backup-plugin",
	serviceKey: "backupService",
	createService: (app) => {
		const autoSnapshot = {
			enabled: false,
			keep: app.env.AUTO_SNAPSHOT_KEEP,
		}
		const service = createBackupService({
			db: app.dbHandles,
			paths: app.paths,
			dbFilePath: app.env.DATABASE_URL,
			getActiveVersion: () => app.versionService.active(),
			autoSnapshot,
		})
		return service
	},
	dependencies: ["env-plugin", "db-plugin", "paths-plugin", "version-plugin"],
})
