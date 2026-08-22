import "src/infra/fastify-augment.ts"
import { buildServicePlugin } from "src/infra/plugins.ts"
import { createVersionService } from "./service.ts"

/**
 * Wire the {@link VersionService} into the Fastify instance. The service
 * needs the writable DB handles (for `VACUUM INTO`) and the storage root
 * (for the version-state file + per-version directory enumeration).
 */
export const versionPlugin = buildServicePlugin({
	name: "version-plugin",
	serviceKey: "versionService",
	createService: (app) =>
		createVersionService({
			db: app.dbHandles,
			storageRoot: app.env.STORAGE_ROOT,
			readOnly: app.readOnly,
		}),
	dependencies: ["env-plugin", "db-plugin"],
})
