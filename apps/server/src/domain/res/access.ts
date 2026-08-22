import type { PluginHooks, PluginProbeCache } from "@hoardodile/host"
import {
	createPluginResourceAPI,
	DEFAULT_PLUGIN_EXTRACT_MAX_BYTES,
	DEFAULT_PLUGIN_EXTRACT_MAX_ENTRIES,
	type NestedCdCache,
	type ResourceAPI,
} from "@hoardodile/host"
import { mediaProbes } from "@hoardodile/host/probe"
import type { FileStats } from "@hoardodile/schemas"
import type {
	PluginManifestId,
	SerializedFileList,
} from "@hoardodile/sdk-types"
import type { StoragePaths } from "src/infra/storage/paths.ts"
import { aggregateSourceFiles } from "./source-meta.ts"
import {
	buildSourceArtifactView,
	locateSourceArtifact,
	type SourceArtifactView,
} from "./source-view.ts"

export type ResourceAccessDeps = {
	readonly paths: StoragePaths
	readonly pluginHooks: PluginHooks
	/**
	 * Shared probe cache, scoped per (resId, fileVersion) at wrap time.
	 * Optional so trash-fallback consumers can build a lean access —
	 * the wiring is identical, only cache hits are skipped.
	 */
	readonly probeCache?: PluginProbeCache
	/** Process-wide nested central-directory cache. Optional (misses only). */
	readonly nestedCdCache?: NestedCdCache
	readonly maxExtractBytes?: number
	readonly maxExtractEntries?: number
	readonly onExtractProgress?: (
		resId: string,
		progress: { readonly done: number; readonly total: number },
	) => void
}

/**
 * The resource access layer: the single place that turns a resource's
 * id + fileVersion into everything the plugin-visible surface needs —
 * the artifact view, the ResourceAPI (with every capability wired:
 * probe cache, nested CD cache, extraction caps, progress), the file
 * list (plugin-provided, container canonical order otherwise) and the
 * file statistics aggregation. Consumers (the res service, trash
 * fallback, meta rebuilds) call these instead of re-constructing the
 * wiring, so adding an API capability or a list/stat rule changes one
 * function, not every consumer.
 */
export type ResourceAccess = {
	/** Resolve the artifact view of a committed resource version. */
	readonly buildView: (
		resId: string,
		fileVersion: number,
	) => Promise<SourceArtifactView>
	/**
	 * Wrap a view into the full ResourceAPI. This is the single
	 * construction site for every plugin-facing capability.
	 */
	readonly wrapApi: (
		view: SourceArtifactView,
		resId: string,
		fileVersion: number,
	) => ResourceAPI
	/** Convenience: resolve the view and wrap it. */
	readonly apiFor: (resId: string, fileVersion: number) => Promise<ResourceAPI>
	/**
	 * The file list the owning plugin declares, or the container's
	 * canonical order (`.order` manifest when present, natural name sort
	 * otherwise) when the plugin has no list hook.
	 */
	readonly listFiles: (
		api: ResourceAPI,
		pluginId: PluginManifestId,
	) => Promise<SerializedFileList>
	/** Aggregate size and count from the view. `undefined` when unreadable. */
	readonly fileStats: (
		view: Pick<SourceArtifactView, "listEntries" | "resolveByteRange">,
	) => Promise<FileStats | undefined>
}

/** Build a {@link ResourceAccess} over the given deps. */
export function buildResourceAccess(deps: ResourceAccessDeps): ResourceAccess {
	async function buildView(
		resId: string,
		fileVersion: number,
	): Promise<SourceArtifactView> {
		const spec = await locateSourceArtifact(deps.paths, resId, fileVersion)
		return buildSourceArtifactView(
			{
				paths: deps.paths,
				nestedCdCache: deps.nestedCdCache,
				cacheScope: `${resId}:${fileVersion}`,
			},
			resId,
			fileVersion,
			spec,
		)
	}

	function wrapApi(
		view: SourceArtifactView,
		resId: string,
		fileVersion: number,
	): ResourceAPI {
		return createPluginResourceAPI({
			view,
			...mediaProbes,
			probeCache: deps.probeCache,
			cacheScope: `${resId}:${fileVersion}`,
			extractCacheDir: deps.paths.local.resExtractedArchivesDir(
				resId,
				fileVersion,
			),
			maxExtractBytes: deps.maxExtractBytes ?? DEFAULT_PLUGIN_EXTRACT_MAX_BYTES,
			maxExtractEntries:
				deps.maxExtractEntries ?? DEFAULT_PLUGIN_EXTRACT_MAX_ENTRIES,
			nestedCdCache: deps.nestedCdCache,
			onExtractProgress: deps.onExtractProgress
				? (progress) =>
						deps.onExtractProgress?.(resId, {
							done: progress.done,
							total: progress.total,
						})
				: undefined,
		})
	}

	async function apiFor(
		resId: string,
		fileVersion: number,
	): Promise<ResourceAPI> {
		const view = await buildView(resId, fileVersion)
		return wrapApi(view, resId, fileVersion)
	}

	async function listFiles(
		api: ResourceAPI,
		pluginId: PluginManifestId,
	): Promise<SerializedFileList> {
		const pluginResult = await deps.pluginHooks.buildFileList(api, pluginId)
		if (pluginResult !== undefined) return pluginResult
		return api.listFileNames()
	}

	async function fileStats(
		view: Pick<SourceArtifactView, "listEntries" | "resolveByteRange">,
	): Promise<FileStats | undefined> {
		return aggregateSourceFiles(view)
	}

	return { buildView, wrapApi, apiFor, listFiles, fileStats }
}
