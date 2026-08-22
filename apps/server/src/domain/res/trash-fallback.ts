import { readdir, stat } from "node:fs/promises"
import { join } from "node:path"
import type { PluginHooks } from "@hoardodile/host"
import type { FileStats } from "@hoardodile/schemas"
import type {
	PluginManifestId,
	SerializedFileList,
} from "@hoardodile/sdk-types"
import {
	RESOURCE_DATA_DIR_NAME,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import type { ResourceAccess } from "./access.ts"
import {
	buildSourceArtifactView,
	type SourceArtifactView,
} from "./source-view.ts"

export type TrashFallbackDeps = {
	readonly paths: StoragePaths
	readonly pluginHooks: PluginHooks
	/**
	 * The resource access layer: trash views are wrapped, listed and
	 * aggregated through the same single implementation every live
	 * resource uses (see access.ts).
	 */
	readonly access: ResourceAccess
}

export async function findTrashedResourcePath(
	paths: StoragePaths,
	id: string,
): Promise<string | undefined> {
	const trashDir = paths.local.trash()
	const entries = await readdirSafe(trashDir)
	const prefix = `resources-${id}-`
	for (const entry of entries) {
		if (entry.startsWith(prefix)) {
			return join(trashDir, entry)
		}
	}
	return undefined
}

export async function buildTrashedArtifactView(
	paths: StoragePaths,
	id: string,
): Promise<SourceArtifactView | undefined> {
	const trashPath = await findTrashedResourcePath(paths, id)
	if (trashPath === undefined) return undefined
	// The trash entry keeps the resource folder layout, so the content
	// root is the `data/` subfolder — the same root live resources use.
	const dataDir = join(trashPath, RESOURCE_DATA_DIR_NAME)
	const info = await stat(dataDir).catch(() => undefined)
	if (info?.isDirectory() !== true) return undefined
	return buildSourceArtifactView({ paths, cacheScope: `${id}:0` }, id, 0, {
		kind: "dir",
		dirPath: dataDir,
	})
}

export async function detectPluginForTrash(
	deps: TrashFallbackDeps,
	id: string,
): Promise<PluginManifestId | undefined> {
	const view = await buildTrashedArtifactView(deps.paths, id)
	if (view === undefined) return undefined
	const api = deps.access.wrapApi(view, id, 0)
	try {
		return await deps.pluginHooks.detectFirstMatch(api)
	} catch {
		return undefined
	}
}

export async function buildTrashedFileList(
	deps: TrashFallbackDeps,
	id: string,
): Promise<SerializedFileList | undefined> {
	const view = await buildTrashedArtifactView(deps.paths, id)
	if (view === undefined) return undefined
	const api = deps.access.wrapApi(view, id, 0)
	let contentPluginId: PluginManifestId
	try {
		contentPluginId = await deps.pluginHooks.detectFirstMatch(api)
	} catch {
		return undefined
	}
	return deps.access.listFiles(api, contentPluginId)
}

export async function computeTrashedFileStats(
	deps: TrashFallbackDeps,
	id: string,
): Promise<FileStats | undefined> {
	const view = await buildTrashedArtifactView(deps.paths, id)
	if (view === undefined) return undefined
	return deps.access.fileStats(view)
}

async function readdirSafe(dir: string): Promise<string[]> {
	try {
		const entries = await readdir(dir, { withFileTypes: true })
		return entries.filter((e) => e.isDirectory()).map((e) => e.name)
	} catch {
		return []
	}
}
