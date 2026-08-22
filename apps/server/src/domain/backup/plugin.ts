import { statfs } from "node:fs/promises"
import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createAutoSnapshotScheduler } from "./scheduler.ts"
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
			enabled: app.env.AUTO_SNAPSHOT_ENABLED,
			keep: app.env.AUTO_SNAPSHOT_KEEP,
		}
		const service = createBackupService({
			db: app.dbHandles,
			paths: app.paths,
			dbFilePath: app.env.DATABASE_URL,
			getActiveVersion: () => app.versionService.active(),
			autoSnapshot,
		})
		if (autoSnapshot.enabled) {
			const scheduler = createAutoSnapshotScheduler({
				service,
				keep: autoSnapshot.keep,
				isReadOnly: () => app.readOnly,
				readFreeBytes: async () => {
					try {
						const stats = await statfs(app.paths.root)
						return stats.bavail * stats.bsize
					} catch {
						return undefined
					}
				},
				minFreeBytes: app.env.MIN_FREE_DISK_BYTES,
				onError: (err) => app.log.error({ err }, "auto-snapshot.run_failed"),
				onSkip: (reason) =>
					app.log.warn(
						{ minFreeBytes: app.env.MIN_FREE_DISK_BYTES },
						`auto-snapshot.skipped_${reason}`,
					),
			})
			void scheduler.start()
			app.addHook("onClose", async () => scheduler.stop())
		}
		return service
	},
	dependencies: ["env-plugin", "db-plugin", "paths-plugin", "version-plugin"],
})
