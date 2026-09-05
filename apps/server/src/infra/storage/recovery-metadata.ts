import { readFile } from "node:fs/promises"
import {
	BackupError,
	confinedPath,
	type RecoveryManifest,
	sha256File,
	walkFiles,
} from "@hoardodile/backup"
import { pluginManifest } from "@hoardodile/sdk-types/schema"
import { gte, valid } from "semver"
import {
	snapshotReferenceTree,
	verifyDatabaseReferences,
} from "./references.ts"

/** Check every frozen database and plugin declaration before overwriting library files. */
export async function validateRecoveryMetadata(options: {
	metadataRoot: string
	manifest: RecoveryManifest
	files: ReadonlySet<string>
	appVersion: string
	validateDatabase: (path: string) => Promise<void>
}): Promise<void> {
	const tree = snapshotReferenceTree(options.files)
	const validatedPlugins = new Set<string>()
	for await (const path of walkFiles(options.metadataRoot)) {
		const absolute = confinedPath(options.metadataRoot, path)
		const archivedDatabase = /^([1-9][0-9]*)\/app\.sqlite$/.exec(path)
		if (path === options.manifest.databasePath || archivedDatabase) {
			await options.validateDatabase(absolute)
			await verifyDatabaseReferences({
				database: absolute,
				archiveVersion: archivedDatabase
					? Number(archivedDatabase[1])
					: options.manifest.latestVersion,
				tree,
			})
		}
		const pluginPath = /^([1-9][0-9]*)\/plugins\/([^/]+)\/manifest\.json$/.exec(
			path,
		)
		if (!pluginPath) continue
		const expected = options.manifest.plugins.find(
			(entry) =>
				entry.archiveVersion === Number(pluginPath[1]) &&
				entry.id === pluginPath[2],
		)
		if (!expected || (await sha256File(absolute)) !== expected.manifestSha256)
			throw new BackupError(
				"plugin_manifest_mismatch",
				"An archived plugin declaration failed verification",
			)
		const plugin = pluginManifest.safeParse(
			JSON.parse(await readFile(absolute, "utf8")),
		)
		if (
			!plugin.success ||
			plugin.data.id !== expected.id ||
			plugin.data.version !== expected.version ||
			(plugin.data.minAppVersion !== undefined &&
				(!valid(plugin.data.minAppVersion) ||
					!valid(options.appVersion) ||
					!gte(options.appVersion, plugin.data.minAppVersion)))
		)
			throw new BackupError(
				"unsupported_plugin",
				`The archived plugin ${expected.id} requires a compatible application version`,
			)
		validatedPlugins.add(`${expected.archiveVersion}/${expected.id}`)
	}
	if (validatedPlugins.size !== options.manifest.plugins.length)
		throw new BackupError(
			"missing_plugin_manifest",
			"An archived plugin declaration is missing",
		)
}
