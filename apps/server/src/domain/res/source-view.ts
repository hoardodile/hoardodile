import { rm, stat } from "node:fs/promises"
import {
	createDirectoryContainer,
	createNestedAwareContainer,
	materializeFile,
	type NestedCdCache,
	type ResourceContainer,
	resolveSafeImportPath,
} from "@hoardodile/host"
import { notFound } from "@hoardodile/shared"
import type { StoragePaths } from "src/infra/storage/paths.ts"

function extractInflightKey(
	resId: string,
	fileVersion: number,
	relPath: string,
): string {
	return `${resId}@${fileVersion}:${relPath}`
}

/**
 * Read-side view over a resource's source folder (bare files on disk).
 * A thin wrapper over the host container stack —
 * `createDirectoryContainer` for direct file IO, `createNestedAwareContainer`
 * for `outer!inner` addressing — plus the server's extraction-cache
 * materialization and domain error semantics.
 *
 * All raw zip reading lives in `@hoardodile/host`, so the plugin
 * runtime, the thumbnail pipeline and the HTTP read routes share one
 * implementation.
 *
 * All `relPath` arguments are entry names relative to the resource
 * folder (may contain `/`; `outer!inner` addresses inside an uploaded
 * archive file).
 */
export type SourceArtifactView = ResourceContainer & {
	readonly resId: string
	readonly fileVersion: number
	readonly kind: "dir" | "empty"
	/**
	 * Absolute on-disk path of the resource folder. Empty string
	 * when `kind === "empty"` (no artifact committed yet).
	 */
	readonly dirPath: string
	/**
	 * Resolve `relPath` to an absolute path on disk and call `fn(path)`.
	 * Literal entries are already bare files — `fn` receives the file
	 * path directly with no copy. Virtual entries (`outer!inner`) are
	 * extracted once into a versioned cache under
	 * `local/cache/resources/<id>/extracted/` and reused across calls
	 * until derived artifacts are cleared.
	 */
	withMaterializedEntry<T>(
		relPath: string,
		fn: (path: string) => Promise<T>,
	): Promise<T>
	/**
	 * Alias for {@link withMaterializedEntry} — use when the consumer
	 * requires a seekable filesystem path (e.g. ffmpeg mid-file seek).
	 */
	withSeekableEntry<T>(
		relPath: string,
		fn: (path: string) => Promise<T>,
	): Promise<T>
}

export type SourceArtifactSpec =
	| { readonly kind: "dir"; readonly dirPath: string }
	| { readonly kind: "empty" }

export type SourceViewDeps = {
	readonly paths: StoragePaths
	/**
	 * Process-wide nested central-directory cache, shared with the
	 * plugin API so a multi-hook pass parses each nested archive's CD
	 * once. Falls back to a fresh cache when omitted.
	 */
	readonly nestedCdCache?: NestedCdCache
	/**
	 * Disambiguator for the shared nested cache — typically
	 * `${resId}:${fileVersion}`. Without it, two resources holding
	 * same-named archives would serve each other's listings.
	 */
	readonly cacheScope?: string
}

/**
 * Build a {@link SourceArtifactView} for `(resId, fileVersion, spec)`.
 * The view is cheap to construct — caches and file handles are
 * acquired lazily on first call.
 */
export function buildSourceArtifactView(
	deps: SourceViewDeps,
	resId: string,
	fileVersion: number,
	spec: SourceArtifactSpec,
): SourceArtifactView {
	if (spec.kind === "empty") {
		return buildEmptyView(resId, fileVersion)
	}
	return buildDirView(deps, resId, fileVersion, spec.dirPath)
}

function buildEmptyView(
	resId: string,
	fileVersion: number,
): SourceArtifactView {
	function fail(relPath: string): never {
		throw notFound(
			"resource.file_not_found",
			`resource ${resId} has no source artifact yet`,
			{ resId, relPath },
		)
	}

	return {
		resId,
		fileVersion,
		kind: "empty",
		dirPath: "",
		listEntries: async () => [],
		readEntry: async (relPath) => fail(relPath),
		readEntrySlice: async (relPath) => fail(relPath),
		openEntryStream: async (relPath) => fail(relPath),
		resolveByteRange: async () => undefined,
		withMaterializedEntry: async (relPath) => fail(relPath),
		withSeekableEntry: async (relPath) => fail(relPath),
	}
}

function buildDirView(
	deps: SourceViewDeps,
	resId: string,
	fileVersion: number,
	dirPath: string,
): SourceArtifactView {
	// Literal reads hit the filesystem directly; `outer!inner` addressing
	// resolves through the nested resolver (zip/tar entries inside an
	// uploaded archive file) — both from the host container stack. The
	// extraction cache dir extends `outer!inner` to *materialized* archive
	// entries (tar/7z/rar): once a plugin calls `extractArchive`, the inner
	// file is served from the same cache directory the plugin API writes to,
	// so `/files/<token>/outer!inner` addresses every container kind. Zip
	// stays on the central-directory stream even without a cache entry.
	const container = createNestedAwareContainer(
		createDirectoryContainer(dirPath),
		deps.nestedCdCache,
		deps.cacheScope,
		deps.paths.local.resExtractedArchivesDir(resId, fileVersion),
	)

	/**
	 * Process-wide listing cache for versioned resource folders. A
	 * resource folder is immutable between commits (replacements move
	 * the whole folder aside first), so the listing only changes when
	 * the folder's stat signature changes — one `stat` instead of a
	 * recursive walk + sort per request.
	 */
	const LISTING_CACHE_MAX = 10_000
	const listingCache = new Map<
		string,
		{ readonly signature: string; readonly entries: readonly string[] }
	>()

	async function folderSignature(): Promise<string> {
		const info = await stat(dirPath).catch(() => undefined)
		return info === undefined ? "missing" : `${info.size}:${info.mtimeMs}`
	}

	async function listEntries(): Promise<readonly string[]> {
		const signature = await folderSignature()
		const hit = listingCache.get(dirPath)
		if (hit !== undefined && hit.signature === signature) {
			return hit.entries
		}
		const entries = await container.listEntries()
		listingCache.set(dirPath, { signature, entries })
		if (listingCache.size > LISTING_CACHE_MAX) {
			const oldest = listingCache.keys().next().value
			if (oldest !== undefined) listingCache.delete(oldest)
		}
		return entries
	}

	function missing(relPath: string): never {
		throw notFound(
			"resource.file_not_found",
			`resource ${resId} has no entry ${relPath}`,
			{ resId, relPath },
		)
	}

	// Pre-resolve so missing entries surface as the domain error above
	// instead of the container's plain Error.
	async function requireSize(relPath: string): Promise<number> {
		const range = await container.resolveByteRange(relPath)
		if (range === undefined) return missing(relPath)
		return range.size
	}

	async function readEntry(relPath: string): Promise<Buffer> {
		await requireSize(relPath)
		return container.readEntry(relPath)
	}

	async function readEntrySlice(
		relPath: string,
		start: number,
		end: number,
	): Promise<Buffer> {
		await requireSize(relPath)
		return container.readEntrySlice(relPath, start, end)
	}

	async function openEntryStream(relPath: string) {
		await requireSize(relPath)
		return container.openEntryStream(relPath)
	}

	async function materializeToCache(
		relPath: string,
		size: number,
	): Promise<string> {
		const cachePath = deps.paths.local.resExtractedEntry(
			resId,
			fileVersion,
			relPath,
		)
		if (await statValidCache(cachePath, size)) {
			return cachePath
		}
		const inflightKey = extractInflightKey(resId, fileVersion, relPath)
		return materializeFile({
			key: inflightKey,
			openStream: () =>
				container.openEntryStream(relPath).then((entry) => entry.stream),
			target: cachePath,
			expectedSize: size,
		}).then(() => cachePath)
	}

	async function withMaterializedEntry<T>(
		relPath: string,
		fn: (path: string) => Promise<T>,
	): Promise<T> {
		const size = await requireSize(relPath)
		// The `!` heuristic mirrors the nested resolver's ambiguity rule:
		// a literal file whose NAME contains `!` (but is not a container)
		// also takes the cache path here. That is intentionally wasteful
		// (one extra copy) and never wrong — do not "optimize" it away
		// without re-deriving the resolver's sniff-first semantics.
		if (!relPath.includes("!")) {
			// Literal entry: the file is already on disk — hand the path
			// over with no copy, so ffmpeg/ffprobe can seek the real file.
			return fn(resolveSafeImportPath(dirPath, relPath))
		}
		const cachePath = await materializeToCache(relPath, size)
		return fn(cachePath)
	}

	return {
		resId,
		fileVersion,
		kind: "dir",
		dirPath,
		listEntries,
		readEntry,
		readEntrySlice,
		openEntryStream,
		resolveByteRange: container.resolveByteRange,
		resolveSeekablePath: container.resolveSeekablePath,
		withMaterializedEntry,
		withSeekableEntry: withMaterializedEntry,
	}
}

/**
 * Resolve `(resId, fileVersion)` into a {@link SourceArtifactSpec} by
 * inspecting `paths.atVersion(fileVersion).resourceData(id)`.
 *
 * Returns `{ kind: "dir" }` when the resource's content root (`data/`)
 * exists, `{ kind: "empty" }` otherwise (no artifact committed yet —
 * a resource may exist with only root metadata like `.cover.*`).
 */
export async function locateSourceArtifact(
	paths: StoragePaths,
	id: string,
	fileVersion: number,
): Promise<SourceArtifactSpec> {
	const dirPath = paths.atVersion(fileVersion).resourceData(id)
	const info = await stat(dirPath).catch(() => undefined)
	if (info?.isDirectory() !== true) return { kind: "empty" }
	return { kind: "dir", dirPath }
}

async function statValidCache(
	cachePath: string,
	expectedSize: number,
): Promise<boolean> {
	const info = await stat(cachePath).catch(() => undefined)
	if (!info?.isFile()) return false
	if (info.size !== expectedSize) {
		await rm(cachePath, { force: true }).catch(() => {})
		return false
	}
	return true
}
