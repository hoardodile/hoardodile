import { BackupError } from "@hoardodile/backup"
import type { FastifyInstance } from "fastify"

export function assertArchivablePlugins(app: FastifyInstance): void {
	if (
		(!app.env.DISABLE_DEV_PLUGINS && app.env.DEV_PLUGIN_PATHS.length > 0) ||
		app.pluginLoader
			.getRegistry()
			.getAll()
			.some((entry) => entry.dev)
	) {
		throw new BackupError(
			"development_plugin",
			"Install development plugins as regular packages before creating an archive or recovery point",
		)
	}
}
