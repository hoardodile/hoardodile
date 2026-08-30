import type { PluginHooks } from "@hoardodile/host"
import {
	createNestedCdCache,
	createProbeCache,
	type PluginProbeCache,
} from "@hoardodile/host"
import type {
	DuplicateImagesResult,
	FileStats,
	ImageSearchResult,
	IntraSimilarResult,
	ResCard,
	Resource,
	ResourceDislike,
	ResourceDislikeResult,
	ResourceMetaSnapshot,
	ResourceMetaType,
	SimilarImagesResult,
} from "@hoardodile/schemas"
import { HASHES_META_VERSION, MAX_PAGE_SIZE } from "@hoardodile/schemas"
import { RESOURCE_DISLIKE_CANCEL_WINDOW_MS } from "@hoardodile/schemas/res"
import type { Detection, ResourceAPI } from "@hoardodile/sdk-server"
import type {
	PluginManifestId,
	SerializedFileList,
} from "@hoardodile/sdk-types"
import { err, isErr, ok, type Result } from "@hoardodile/sdk-types"
import type { ListPageInput, ListPageResult } from "@hoardodile/shared"
import { conflict, invalid, isDomainError } from "@hoardodile/shared"
import { buildCharacterFiles } from "src/domain/char/files.ts"
import { ensureCharImageMeta } from "src/domain/char/image-meta.ts"
import { buildCharacterRepository } from "src/domain/char/repo.ts"
import { loadSiblingPairs } from "src/domain/tag/collapse.ts"
import { siblingDisplayOf } from "src/domain/tag/rules.ts"
import type {
	TraceAction,
	TraceActionDetail,
	UserAction,
} from "src/domain/trace/actions.ts"
import { createConcurrencyLimiter } from "src/infra/concurrency-limiter.ts"
import type { SqliteDb } from "src/infra/db/connection.ts"
import { runStages, type Stage } from "src/infra/pipeline/run-stages.ts"
import type { MutableRef } from "src/infra/runtime-context.ts"
import {
	applyPageBounds,
	buildSoftDeleteOps,
	type ClockDeps,
	filterDefined,
	resolveClock,
} from "src/infra/service.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"
import { decodeGrayGridFromFile } from "src/infra/thumb/grid.ts"
import { formatTimestamp } from "src/lib/date.ts"
import { buildResourceAccess } from "./access.ts"
import { buildResourceCoverOps } from "./cover-ops.ts"
import {
	createExtractProgressStore,
	type ExtractProgressStore,
} from "./extract-progress.ts"
import { buildResourceFiles } from "./files.ts"
import { buildResHashService, type QueryHashMatch } from "./hash-service.ts"
import {
	buildImageSearchSessions,
	type ImageSearchSessions,
} from "./image-search.ts"
import {
	ALL_META_UNITS,
	buildResMetaOps,
	type CoverRenderResult,
	type MetaRebuildUnit,
	PRECACHE_META_UNITS,
	type RebuiltResource,
} from "./meta-ops.ts"
import {
	buildResourceRepository,
	parseHashesMeta,
	type ResDbPatch,
	type ResRow,
	rowToResource,
	rowToResourceCard,
	type SourceNameCount,
} from "./repo.ts"
import type { SourceArtifactView } from "./source-view.ts"
import {
	buildTrashedArtifactView,
	buildTrashedFileList,
} from "./trash-fallback.ts"
import { buildResourceUploads, type ResUploads } from "./upload.ts"

export type SetContentPluginIdResult = Result<
	{ readonly resource: Resource },
	{ readonly failure: Extract<Detection, { ok: false }> }
>

/** Bounded concurrency for the bulk-replace detect gate — a large set must
    stay responsive without spinning up an unbounded number of sandboxed
    plugin detectors at once. */
const REPLACE_DETECT_CONCURRENCY = 4

export type ResServiceDeps = ClockDeps & {
	readonly db: SqliteDb
	readonly paths: StoragePaths
	readonly readOnly: MutableRef<boolean>
	readonly uploads?: ResUploads
	/** Plugin hook facade - required. Builtin plugin must be registered. */
	readonly pluginHooks: PluginHooks
	/**
	 * Hard caps for one `extractArchive` call. Defaults to
	 * {@link DEFAULT_PLUGIN_EXTRACT_MAX_BYTES} /
	 * {@link DEFAULT_PLUGIN_EXTRACT_MAX_ENTRIES}.
	 */
	readonly maxPluginExtractBytes?: number
	readonly maxPluginExtractEntries?: number
	/** Called when any meta is rebuilt and changed for a resource. */
	readonly onMetaUpdated?: (
		resourceId: string,
		metaTypes: ResourceMetaType[],
		meta: ResourceMetaSnapshot,
	) => void
	/** Fire-and-forget hook after a resource upload commit succeeds. */
	readonly onUploadCommitted?: (id: string) => void
	/**
	 * Optional listener for discrete user actions (import, export, delete,
	 * restore, dislike). Wired to the trace domain at the composition root.
	 */
	readonly onUserAction?: (action: UserAction) => void
}

export type ResCreateInput = {
	readonly name?: string
	/** IANA zone for the fallback name when `name` is omitted. */
	readonly defaultNameTimeZone?: string
	readonly intro?: string
	readonly sourceName?: string
	readonly sourceUrl?: string
	readonly contentPluginId?: PluginManifestId
	readonly tagIds?: readonly string[]
	readonly charIds?: readonly string[]
	/**
	 * Ordered list of `fileId`s previously staged via the per-file upload
	 * endpoint (`POST /api/uploads/ordered`). Each `fileId` must resolve to
	 * a staged pool file; consumed files are removed on successful commit.
	 * Mutually exclusive with {@link archiveFileId}.
	 */
	readonly files?: readonly string[]
	/**
	 * Original client filenames, parallel to {@link files}. Each is
	 * sanitized at commit and becomes the on-disk entry name. Falls back
	 * to a generated name when omitted.
	 */
	readonly names?: readonly string[]
	/**
	 * `fileId` of a single archive (zip) previously staged via
	 * `POST /api/uploads/archive`. The archive is validated and
	 * installed as-is under the sanitized {@link filename}.
	 * Mutually exclusive with {@link files}.
	 */
	readonly archiveFileId?: string
	/**
	 * Original client filename of the staged archive (e.g. `vol1.cbz`).
	 * Sanitized at commit; becomes the on-disk file name.
	 */
	readonly filename?: string
	/**
	 * Absolute path of a local directory whose file tree becomes the
	 * resource source (folder import). Internal-only: not exposed on the
	 * public router; the import flow passes it directly.
	 */
	readonly directoryPath?: string
}

export type ResUpdateInput = {
	readonly id: string
	readonly name?: string
	readonly intro?: string
	readonly sourceName?: string
	readonly sourceUrl?: string
	readonly tagIds?: readonly string[]
	readonly charIds?: readonly string[]
}

/**
 * Input for {@link ResService.memories}. `month`/`day` are the user's
 * local calendar day; `offsetMin` lets the server interpret `createdAt`
 * in that same calendar day.
 */
export type ResMemoriesInput = {
	readonly month: number
	readonly day: number
	readonly offsetMin: number
}

export type HardDeleteResult = {
	readonly trashedPath: string
}

export type ResManyDeleteFailure = {
	readonly id: string
	readonly code: string
	readonly message: string
}

export type ResManyDeleteResult = {
	readonly okIds: readonly string[]
	readonly failures: readonly ResManyDeleteFailure[]
}

export type ResCoverStore = {
	hasCoverMeta(id: string): Promise<boolean>
}

export type ResMetaScheduler = {
	hasSourceMeta(id: string): Promise<boolean>
	enqueueFullMetaRebuild(id: string): void
	enqueueFileStatsRebuild(id: string): void
	enqueuePluginMetaRebuild(id: string): void
	enqueueCoverMetaRebuild(id: string): void
	clearAllMeta(): void
	rebuildAllMeta(id: string): Promise<void>
	rebuildCoverMeta(id: string): Promise<void>
	recordCoverMetaFromRenderedThumb(id: string, thumbPath: string): Promise<void>
	rebuildResourceFully(
		id: string,
		renderCover: (id: string) => Promise<CoverRenderResult>,
	): Promise<RebuiltResource>
	/** Wait for all background meta rebuild queues to settle. */
	drainMetaQueue(): Promise<void>
}

export type ResPreviewSource = {
	findCover(id: string): Promise<string | undefined>
	getContentPluginId(id: string): Promise<string | null>
	resolveSourceView(id: string): Promise<SourceArtifactView>
	/**
	 * Resolve the artifact view of a hard-deleted resource from its
	 * `local/trash/` entry. `undefined` when no trash entry matches.
	 * Optional so consumers can treat live resources and trash entries
	 * uniformly (the thumbnail pipeline falls back here when the live
	 * row is gone).
	 */
	resolveTrashedSourceView?(id: string): Promise<SourceArtifactView | undefined>
	resolveLocalCoverSource(id: string): Promise<string | undefined>
	/**
	 * Process-wide probe cache, scoped per (resId, fileVersion) — shared
	 * with the plugin API so sniff/probe results are reused by the thumb
	 * pipeline too.
	 */
	readonly probeCache: PluginProbeCache
}

export type ResService = ResCoverStore &
	ResMetaScheduler &
	ResPreviewSource & {
		list(input: ListPageInput): Promise<ListPageResult<Resource>>
		listCards(input: ListPageInput): Promise<ListPageResult<ResCard>>
		trashList(input: ListPageInput): Promise<ListPageResult<Resource>>
		trashListCards(input: ListPageInput): Promise<ListPageResult<ResCard>>
		detail(id: string): Promise<Resource>
		detailCard(id: string): Promise<ResCard>
		create(input: ResCreateInput): Promise<Resource>
		update(input: ResUpdateInput): Promise<Resource>
		softDelete(id: string): Promise<Resource>
		softDeleteMany(ids: readonly string[]): Promise<ResManyDeleteResult>
		restore(id: string): Promise<Resource>
		hardDelete(id: string): Promise<HardDeleteResult>
		hardDeleteMany(ids: readonly string[]): Promise<ResManyDeleteResult>
		setContentPluginId(
			id: string,
			next: PluginManifestId,
		): Promise<SetContentPluginIdResult>
		listFiles(id: string): Promise<SerializedFileList>
		listTrashedFiles(id: string): Promise<SerializedFileList | undefined>
		setCover(id: string, ext: string, data: Buffer): Promise<Resource>
		clearCover(id: string): Promise<Resource>
		rebuildPluginMeta(id: string): Promise<void>
		getFileVersion(id: string): Promise<number>
		relatedByTags(id: string, limit: number): Promise<readonly ResCard[]>
		/** Live resources currently bound to the given content plugin. */
		countByContentPluginId(pluginId: string): number
		/**
		 * Bulk-switch every live resource owned by `fromPluginId` to
		 * `toPluginId`. Each resource is first checked against the target
		 * plugin's detector; only resources it can actually recognize are
		 * switched (plugin id swapped and derived metadata atomically
		 * cleared, one transaction). Resources the target rejects stay on
		 * the source plugin and are reported in `failures`. `rebuild` then
		 * decides whether the meta rebuild is enqueued immediately
		 * (`"immediate"` → background) or deferred to the lazy per-resource
		 * flow (`"defer"` → rebuilt when the user next sees it). Returns the
		 * number switched and the skipped resources.
		 */
		replaceContentPlugin(input: {
			readonly fromPluginId: PluginManifestId
			readonly toPluginId: PluginManifestId
			readonly rebuild: "immediate" | "defer"
		}): Promise<{
			readonly affected: number
			readonly failures: readonly {
				readonly id: string
				readonly reasons: readonly string[]
			}[]
		}>
		/**
		 * Distinct content plugin ids across live resources, with the count
		 * each owns — feeds the bulk-replace source picker; ids not in the
		 * live registry are the orphaned (deleted) plugins.
		 */
		listContentPluginUsage(): readonly {
			readonly pluginId: string
			readonly count: number
		}[]
		/**
		 * "On this day" cards: resources created on the given month-day in
		 * previous years, most recent first (capped inside the service).
		 */
		memories(input: ResMemoriesInput): Promise<readonly ResCard[]>
		/**
		 * Distinct user-set source names, most used first. Feeds the
		 * list-page source filter and the form autocomplete.
		 */
		listSourceNames(limit: number): readonly SourceNameCount[]
		/** Similar-image search over perceptual hashes. */
		similarImages(id: string): SimilarImagesResult
		/** Within-resource similarity groups over the resource's own perceptual hashes. */
		similarWithinResource(id: string): IntraSimilarResult
		/** Exact-duplicate search over byte hashes. */
		duplicateImages(id: string): DuplicateImagesResult
		/**
		 * Reverse image search: resources holding images perceptually
		 * similar to the uploaded query image of `sessionId`, ranked by
		 * best Hamming distance, hydrated into cards. Throws NOT_FOUND
		 * for an unknown or expired session.
		 */
		imageSearch(sessionId: string): ImageSearchResult
		/** Session store backing {@link imageSearch} and the upload route. */
		imageSearchSessions: ImageSearchSessions
		/**
		 * Toggle a dislike click. Inside the 24h cancel window a repeat
		 * click removes the previous row (`"cancelled"`); outside the
		 * window each click appends a permanent row (`"added"`).
		 */
		addDislike(resourceId: string): Promise<ResourceDislikeResult>
		/** All dislike rows of a resource, newest first, with server-computed `cancellable`. */
		listDislikes(resourceId: string): Promise<readonly ResourceDislike[]>
		/** In-flight `extractArchive` progress, read by the reader UI. */
		extractProgress: ExtractProgressStore
	}

export function createResourceService(deps: ResServiceDeps): ResService {
	const { now, newId } = resolveClock(deps)
	// Monotonic create-clock guard: batch creates (one resource per
	// staged file) run back-to-back and can share a millisecond, which
	// would scramble their list order through the random-id tiebreak.
	// Scoped to the service instance so injected test clocks stay
	// isolated from each other.
	let lastCreateTs = 0
	const repo = buildResourceRepository(deps.db, now)
	const charRepo = buildCharacterRepository(deps.db)
	const charFiles = buildCharacterFiles(deps.paths, deps.readOnly)

	async function withCharImageMeta(
		cards: readonly ResCard[],
	): Promise<ResCard[]> {
		const ids = cards.flatMap((card) => card.characters.map((ch) => ch.id))
		if (ids.length === 0) return [...cards]
		const meta = await ensureCharImageMeta(charRepo, charFiles, ids)
		return cards.map((card) => ({
			...card,
			characters: card.characters.map((ch) => {
				const imageMeta = meta.get(ch.id)
				return imageMeta !== undefined ? { ...ch, imageMeta } : ch
			}),
		}))
	}

	function recordUserAction(
		action: TraceAction,
		resourceId: string,
		entityName: string,
		detail?: TraceActionDetail,
	): void {
		deps.onUserAction?.({
			action,
			entityType: "resource",
			entityId: resourceId,
			entityName,
			detail,
		})
	}
	const files = buildResourceFiles(deps.paths, deps.readOnly)
	const uploads =
		deps.uploads ??
		buildResourceUploads(
			deps.paths,
			{
				maxArchiveExtractedBytes: Number.MAX_SAFE_INTEGER,
			},
			deps.readOnly,
		)
	const pluginHooks = deps.pluginHooks
	// Process-wide nested central-directory cache: every view and API
	// instance of this service shares it, so a multi-hook pass parses
	// each nested archive's CD once. Keyed by outer entry name only —
	// archives are immutable per version and the cache lives for the
	// service's life.
	const nestedCdCache = createNestedCdCache()

	// Dedupe concurrent `listFiles(id)` calls so a single archive only gets
	// probed once even under fan-out (e.g. many tabs hitting the same
	// huge multi-file resource right after a cold start, before the sidecar
	// cache is populated). Cleared on settle so per-request behaviour
	// matches the cache-hit path afterwards.
	const listFilesInflight = new Map<string, Promise<SerializedFileList>>()

	// Process-wide probe result cache, scoped per (resId, fileVersion) at
	// construction time in the access layer. Source archives are immutable
	// per version, so entries never need explicit invalidation.
	const probeCache = createProbeCache()

	// In-flight extraction progress, surfaced to the reader via the
	// `/extract-progress` route.
	const extractProgress = createExtractProgressStore()

	// The resource access layer: the single construction site for every
	// plugin-facing view/API capability (see access.ts).
	const access = buildResourceAccess({
		paths: deps.paths,
		pluginHooks,
		probeCache,
		nestedCdCache,
		maxExtractBytes: deps.maxPluginExtractBytes,
		maxExtractEntries: deps.maxPluginExtractEntries,
		onExtractProgress: (resId, progress) =>
			extractProgress.record(resId, {
				done: progress.done,
				total: progress.total,
				updatedAt: Date.now(),
			}),
	})

	const cover = buildResourceCoverOps({
		repo,
		files,
	})

	const metaOps = buildResMetaOps({
		repo,
		now,
		pluginHooks,
		createResourceAPI: (resId, fileVersion) =>
			access.apiFor(resId, fileVersion),
		resolveSourceView: async (id) => {
			const row = repo.findById(id)
			return access.buildView(id, row.fileVersion)
		},
		findCover: cover.findCover,
		onMetaUpdated: deps.onMetaUpdated,
	})

	const hashService = buildResHashService({
		listHashes: repo.listHashes,
		listHashesOfType: repo.listHashesOfType,
		findExactHashMatches: repo.findExactHashMatches,
		toResource: (id) => rowToResource(repo.findById(id)),
	})

	// Reverse-image-search sessions: the uploaded query image lives in a
	// tmp session directory with its perceptual hashes as a sidecar (see
	// image-search.ts). The upload route streams into `beginSession`'s
	// image path; tRPC and the session sweep go through the same store.
	const imageSearchSessions = buildImageSearchSessions({
		tmpBase: deps.paths.local.tmp(),
		decodeGrayGrid: decodeGrayGridFromFile,
		newId,
		now,
	})

	// Global dedup lock for rebuildAllMeta (bulk tooling path, e.g. bench
	// seeding and tests). User requests via rebuildMissingMeta never wait —
	// they run immediately so UX is never blocked by a background job.
	const metaRebuildLocks = new Map<string, Promise<void>>()

	function missingMetaUnits(row: ResRow): MetaRebuildUnit[] {
		const units: MetaRebuildUnit[] = []
		if (row.fileStats === null) units.push("fileStats")
		if (row.sourceMeta === null || row.searchMeta === null)
			units.push("pluginMeta")
		if (row.coverMeta === null) units.push("coverMeta")
		if (row.contentPluginId !== null) {
			const effective = pluginHooks.getEffectiveEntry(row.contentPluginId)
			if (pluginHooks.supportsImageHashes(effective.id)) {
				// Stale when the hash algorithm generation moved (the host
				// changed its dhash/phash implementation) or the owning
				// plugin version moved (a plugin upgrade may change its
				// hash policy).
				const meta = parseHashesMeta(row.hashesMeta)
				const stale =
					row.hashesMeta !== null &&
					(meta?.v !== HASHES_META_VERSION ||
						meta.pluginVersion !== effective.manifest.version)
				if (row.hashesMeta === null || stale) units.push("hashes")
			}
		}
		return units
	}

	async function rebuildMissingMetaImpl(row: ResRow): Promise<boolean> {
		const units = missingMetaUnits(row)
		if (row.contentPluginId === null) {
			const coverOnly = units.filter((unit) => unit === "coverMeta")
			if (coverOnly.length === 0) return false
			await metaOps.rebuildMeta(row.id, coverOnly)
			return true
		}
		if (units.length === 0) return false
		await metaOps.rebuildMeta(row.id, units)
		return true
	}

	async function rebuildMissingMeta(row: ResRow): Promise<boolean> {
		// Always use the freshest row so that a concurrent precache finish
		// is visible immediately, avoiding redundant work.
		const fresh = repo.findById(row.id)
		return rebuildMissingMetaImpl(fresh)
	}

	async function lockedRebuildAllMeta(id: string): Promise<void> {
		const existing = metaRebuildLocks.get(id)
		if (existing) return existing
		const p = metaOps.rebuildAllMeta(id).finally(() => {
			metaRebuildLocks.delete(id)
		})
		metaRebuildLocks.set(id, p)
		return p
	}

	function enqueueMissingMetaRebuilds(row: ResRow): void {
		if (row.contentPluginId === null) {
			if (row.coverMeta === null) {
				metaOps.enqueueMetaRebuild(row.id, ["coverMeta"])
			}
			return
		}
		const units = missingMetaUnits(row)
		if (units.length > 0) metaOps.enqueueMetaRebuild(row.id, units)
	}

	function paginateResources(
		trashed: boolean,
		input: ListPageInput,
	): ListPageResult<Resource> {
		const { page, size } = applyPageBounds(input, MAX_PAGE_SIZE)
		const { rows, total } = repo.listPage({
			trashed,
			query: input.query,
			page,
			size,
			charIds: input.charIds,
			noCharacters: input.noCharacters,
			tagIds: input.tagIds,
			tagMode: input.tagMode,
			colIds: input.colIds,
			sortBy: input.sortBy,
			order: input.order,
			random: input.random,
			seed: input.seed,
			contentPluginId: input.contentPluginId,
			searchMetaFacets: input.searchMetaFacets,
			searchIntro: input.searchIntro,
			ids: input.ids,
			dislikedOnly: input.dislikedOnly,
		})
		for (const row of rows) {
			enqueueMissingMetaRebuilds(row)
		}
		return { rows: rows.map(rowToResource), total, page, size }
	}

	async function paginateResourceCards(
		trashed: boolean,
		input: ListPageInput,
	): Promise<ListPageResult<ResCard>> {
		const { page, size } = applyPageBounds(input, MAX_PAGE_SIZE)
		const { rows, total } = repo.listCardPage({
			trashed,
			query: input.query,
			page,
			size,
			charIds: input.charIds,
			noCharacters: input.noCharacters,
			tagIds: input.tagIds,
			tagMode: input.tagMode,
			colIds: input.colIds,
			sortBy: input.sortBy,
			order: input.order,
			random: input.random,
			seed: input.seed,
			contentPluginId: input.contentPluginId,
			searchMetaFacets: input.searchMetaFacets,
			searchIntro: input.searchIntro,
			ids: input.ids,
			dislikedOnly: input.dislikedOnly,
		})
		for (const row of rows) {
			enqueueMissingMetaRebuilds(row)
		}
		const cards = await withCharImageMeta(
			rows.map((row) => withEffectivePlugin(rowToResourceCard(row))),
		)
		return { rows: cards, total, page, size }
	}

	function withEffectivePlugin(card: ResCard): ResCard {
		return {
			...card,
			previewPluginId: pluginHooks.getEffectiveEntry(card.contentPluginId).id,
		}
	}

	async function create(input: ResCreateInput): Promise<Resource> {
		const id = newId()
		const rawTs = now()
		const ts = rawTs > lastCreateTs ? rawTs : lastCreateTs + 1
		lastCreateTs = ts
		const name =
			input.name !== undefined && input.name.length > 0
				? input.name
				: formatTimestamp(ts, input.defaultNameTimeZone ?? "UTC")
		repo.insert(
			id,
			{
				name,
				intro: input.intro ?? "",
				sourceName: input.sourceName?.trim() || null,
				sourceUrl: input.sourceUrl?.trim() || null,
				contentPluginId: input.contentPluginId ?? null,
				tagIds: input.tagIds ?? [],
				charIds: input.charIds ?? [],
			},
			ts,
			deps.paths.latestVersion,
		)
		// Make the per-resource versions directory exist immediately so
		// downstream features (permanent cover writes, manual file drops
		// before first upload) have a stable target. Source artifacts
		// land under this dir on commit; the dir itself is cheap and the
		// rest of the service treats its existence as the post-create
		// invariant.
		await files.ensureFolder(id)
		let resource: Resource
		try {
			if (input.files !== undefined && input.files.length > 0) {
				await applyStagedSource(
					id,
					input.files,
					input.names,
					input.contentPluginId,
				)
				resource = rowToResource(repo.findById(id))
			} else if (input.archiveFileId !== undefined) {
				await applyStagedArchive(
					id,
					input.archiveFileId,
					input.filename,
					input.contentPluginId,
				)
				resource = rowToResource(repo.findById(id))
			} else if (input.directoryPath !== undefined) {
				await uploads.commitDirectoryTree(id, input.directoryPath)
				resource = rowToResource(repo.findById(id))
			} else {
				resource = rowToResource(repo.findById(id))
			}
		} catch (err) {
			repo.remove(id)
			await files.removeFolder(id)
			throw err
		}
		recordUserAction("resource.import", resource.id, resource.name, {
			sourceName: resource.sourceName,
			...(input.files !== undefined ? { fileCount: input.files.length } : {}),
		})
		return resource
	}

	function update(input: ResUpdateInput): Resource {
		repo.findById(input.id)
		// Empty strings clear the source (stored as NULL); undefined leaves
		// the stored value alone.
		const sourceName =
			input.sourceName === undefined
				? undefined
				: input.sourceName.trim() || null
		const sourceUrl =
			input.sourceUrl === undefined ? undefined : input.sourceUrl.trim() || null
		const fields: ResDbPatch = {
			...filterDefined({
				name: input.name,
				intro: input.intro,
				sourceName,
				sourceUrl,
			}),
			updatedAt: now(),
		}
		repo.patch(input.id, fields, {
			tagIds: input.tagIds,
			charIds: input.charIds,
		})
		return rowToResource(repo.findById(input.id))
	}

	const softDeleteOps = buildSoftDeleteOps({
		entity: "resource",
		repo,
		mapper: rowToResource,
		now,
	})

	function softDelete(id: string): Resource {
		const resource = softDeleteOps.softDelete(id)
		recordUserAction("resource.softDelete", resource.id, resource.name)
		return resource
	}

	function restore(id: string): Resource {
		const resource = softDeleteOps.restore(id)
		recordUserAction("resource.restore", resource.id, resource.name)
		return resource
	}

	async function hardDelete(id: string): Promise<HardDeleteResult> {
		const row = repo.findById(id)
		if (row.deletedAt === null) {
			throw conflict(
				"resource.hard_delete_requires_trash",
				`resource ${id} must be soft-deleted first`,
				{ id },
			)
		}
		const filesLiveOnlyInPastArchive =
			row.fileVersion < deps.paths.latestVersion
		let trashedPath: string
		if (filesLiveOnlyInPastArchive) {
			trashedPath = await files.markDeleted(id)
		} else {
			trashedPath = await files.moveFolderToTrash(id)
		}
		await files.clearLocalDerivatives(id).catch(() => {})
		repo.remove(id)
		recordUserAction("resource.hardDelete", row.id, row.name)
		return { trashedPath }
	}

	function dedupeResourceIds(ids: readonly string[]): string[] {
		const seen = new Set<string>()
		const out: string[] = []
		for (const id of ids) {
			if (seen.has(id)) continue
			seen.add(id)
			out.push(id)
		}
		return out
	}

	async function softDeleteMany(
		ids: readonly string[],
	): Promise<ResManyDeleteResult> {
		const okIds: string[] = []
		const failures: ResManyDeleteFailure[] = []
		for (const id of dedupeResourceIds(ids)) {
			try {
				softDelete(id)
				okIds.push(id)
			} catch (err) {
				failures.push(toManyDeleteFailure(id, err))
			}
		}
		return { okIds, failures }
	}

	async function hardDeleteMany(
		ids: readonly string[],
	): Promise<ResManyDeleteResult> {
		const okIds: string[] = []
		const failures: ResManyDeleteFailure[] = []
		for (const id of dedupeResourceIds(ids)) {
			try {
				await hardDelete(id)
				okIds.push(id)
			} catch (err) {
				failures.push(toManyDeleteFailure(id, err))
			}
		}
		return { okIds, failures }
	}

	function toManyDeleteFailure(id: string, err: unknown): ResManyDeleteFailure {
		if (isDomainError(err)) {
			return { id, code: err.code, message: err.message }
		}
		if (err instanceof Error) {
			return {
				id,
				code: "UNKNOWN",
				message: err.message,
			}
		}
		return { id, code: "UNKNOWN", message: String(err) }
	}

	async function listResourceFiles(id: string): Promise<SerializedFileList> {
		const cached = await files.readFilesCache(id)
		if (cached !== undefined) return cached as SerializedFileList

		const existing = listFilesInflight.get(id)
		if (existing !== undefined) return existing

		const work = computeAndCacheFiles(id)
		listFilesInflight.set(id, work)
		try {
			return await work
		} finally {
			listFilesInflight.delete(id)
		}
	}

	async function resolveLocalCoverSource(
		id: string,
	): Promise<string | undefined> {
		const row = repo.findById(id)
		if (row.contentPluginId === null) return undefined
		const api = await access.apiFor(id, row.fileVersion)
		return pluginHooks.resolveLocalCoverSource(
			api,
			pluginHooks.getEffectiveEntry(row.contentPluginId).id,
		)
	}

	async function computeAndCacheFiles(id: string): Promise<SerializedFileList> {
		const row = repo.findById(id)
		let api: ResourceAPI
		try {
			api = await access.apiFor(id, row.fileVersion)
		} catch (err) {
			console.warn(
				`[res] file list for ${id} failed to open the source view: ${err instanceof Error ? err.message : String(err)}`,
			)
			return []
		}

		// If the owning plugin provides buildFileList, delegate to it;
		// otherwise the container's canonical order.
		const effectivePluginId = pluginHooks.getEffectiveEntry(
			row.contentPluginId,
		).id
		const list = await access.listFiles(api, effectivePluginId)
		// Never persist an empty list: a transient failure (a read landing
		// mid-commit, a degraded worker) would otherwise freeze the empty
		// result in files-cache.json and the resource would report no
		// files forever until the cache is cleared. An empty list is cheap
		// to recompute, so only successful listings are cached.
		if (list.length > 0) {
			await files.writeFilesCache(id, list).catch(() => {})
		}
		return list
	}

	/**
	 * Commit an ordered resource from the global single-file staging pool.
	 * On failure the staged pool files are left in place so the client can
	 * retry the commit (or delete them via the per-file DELETE endpoint).
	 */
	async function applyStagedSource(
		id: string,
		fileIds: readonly string[],
		names: readonly string[] | undefined,
		explicitPluginId: PluginManifestId | undefined,
	): Promise<Resource> {
		repo.findById(id)
		await uploads.commitOrderedByIds(id, fileIds, names)
		return finalizeUploadCommit(id, explicitPluginId)
	}

	/**
	 * Commit a resource whose source is a single staged archive (zip).
	 * Mirrors {@link applyStagedSource} but consumes a staged archive by
	 * `fileId` instead of an ordered `fileId` list.
	 */
	async function applyStagedArchive(
		id: string,
		archiveFileId: string,
		filename: string | undefined,
		explicitPluginId: PluginManifestId | undefined,
	): Promise<Resource> {
		repo.findById(id)
		await uploads.commitArchiveById(
			id,
			archiveFileId,
			filename ?? "archive.zip",
		)
		return finalizeUploadCommit(id, explicitPluginId)
	}

	// -- Post-commit import pipeline --

	type ImportContext = {
		readonly id: string
		readonly explicitPluginId: PluginManifestId | undefined
	}

	/**
	 * The shared post-commit tail of both upload paths as declared
	 * stages: placeholder fileStats, derivative cleanup, plugin
	 * detect/revalidate, meta rebuild enqueue, and the warm-cover hook.
	 * Run fail-fast — a failed critical step (placeholder meta, plugin
	 * assignment) must abort the commit so the caller rolls the
	 * resource back. The warm-cover stage is the injection point:
	 * production registers it via `onUploadCommitted`
	 * (infra/thumb/plugin.ts), so a step owned by another module joins
	 * the same chain.
	 */
	const importStages: Stage<ImportContext>[] = [
		{
			label: "placeholder-meta",
			run: async ({ id }) => {
				const newStats: FileStats = { count: 1 }
				repo.patchMeta(
					id,
					{
						fileStats: JSON.stringify(newStats),
						sourceMeta: null,
						coverMeta: null,
					},
					now(),
				)
			},
		},
		{
			label: "clear-derivatives",
			run: async ({ id }) => {
				await files.clearLocalDerivatives(id).catch(() => {})
			},
		},
		{
			label: "assign-plugin",
			run: async ({ id, explicitPluginId }) => {
				if (explicitPluginId !== undefined) {
					await revalidateExplicitPlugin(id)
				} else {
					await detectAndAssignPlugin(id)
				}
			},
		},
		{
			label: "enqueue-meta",
			run: async ({ id }) => {
				// When an upload hook is wired (production), coverMeta is
				// recorded by the warm-cover render from the rendered thumb
				// (see infra/thumb/plugin.ts), so only fileStats+pluginMeta
				// are enqueued here. Standalone usage has no warm render —
				// enqueue the full probe-based rebuild instead.
				metaOps.enqueueMetaRebuild(
					id,
					deps.onUploadCommitted === undefined
						? ALL_META_UNITS
						: PRECACHE_META_UNITS,
				)
			},
		},
		{
			label: "enqueue-hashes",
			run: async ({ id }) => {
				// Hashing decodes every image of the archive, so it never
				// joins the precache path — enqueue it explicitly after
				// every commit.
				metaOps.enqueueMetaRebuild(id, ["hashes"])
			},
		},
		{
			label: "warm-cover",
			run: async ({ id }) => {
				deps.onUploadCommitted?.(id)
			},
		},
		{
			label: "touch",
			run: async ({ id }) => {
				repo.patch(id, { updatedAt: now() })
			},
		},
	]

	/**
	 * Run the post-commit import pipeline for a freshly committed
	 * resource and return its committed row.
	 */
	async function finalizeUploadCommit(
		id: string,
		explicitPluginId: PluginManifestId | undefined,
	): Promise<Resource> {
		await runStages(importStages, { id, explicitPluginId }, { failFast: true })
		return rowToResource(repo.findById(id))
	}

	/**
	 * Run all enabled plugins' detectors in priority order and assign
	 * the first match. The builtin plugin always runs last and always
	 * matches, so this should never fail.
	 */
	async function detectAndAssignPlugin(id: string): Promise<void> {
		const row = repo.findById(id)
		const api = await access.apiFor(id, row.fileVersion)
		const matchedId = await pluginHooks.detectFirstMatch(api)
		if (row.contentPluginId !== matchedId) {
			repo.patch(id, { contentPluginId: matchedId })
		}
	}

	/**
	 * Re-validate after upload when the user set an explicit plugin:
	 * check if that plugin's detector still passes. If not, fall back
	 * to the builtin plugin.
	 */
	async function revalidateExplicitPlugin(id: string): Promise<void> {
		const row = repo.findById(id)
		if (row.contentPluginId === null) return
		const api = await access.apiFor(id, row.fileVersion)
		const validatedId = await pluginHooks.revalidate(api, row.contentPluginId)
		if (validatedId !== row.contentPluginId) {
			repo.patch(id, {
				contentPluginId: validatedId,
				updatedAt: now(),
			})
			metaOps.enqueueFullMetaRebuild(id)
		}
	}

	async function detail(id: string): Promise<Resource> {
		const row = repo.findById(id)
		const dirty = await rebuildMissingMeta(row)
		return rowToResource(dirty ? repo.findById(id) : row)
	}

	async function setContentPluginId(
		id: string,
		next: PluginManifestId,
	): Promise<SetContentPluginIdResult> {
		const row = repo.findById(id)
		if (row.contentPluginId === next) {
			return ok({ resource: rowToResource(row) })
		}
		const api = await access.apiFor(id, row.fileVersion)
		const result = await pluginHooks.detectForPlugin(api, next)
		if (isErr(result)) {
			return err({ failure: result })
		}
		repo.patch(id, { contentPluginId: next, updatedAt: now() })
		await clearDerivedMeta(id)
		metaOps.enqueueFullMetaRebuild(id)
		return ok({ resource: rowToResource(repo.findById(id)) })
	}

	async function clearDerivedMeta(id: string): Promise<void> {
		repo.patchMeta(
			id,
			{
				sourceMeta: null,
				coverMeta: null,
				searchMeta: null,
				hashesMeta: null,
			},
			now(),
		)
		await files.clearLocalDerivatives(id).catch(() => {})
	}

	async function replaceContentPlugin(input: {
		readonly fromPluginId: PluginManifestId
		readonly toPluginId: PluginManifestId
		readonly rebuild: "immediate" | "defer"
	}): Promise<{
		readonly affected: number
		readonly failures: readonly {
			readonly id: string
			readonly reasons: readonly string[]
		}[]
	}> {
		const { fromPluginId, toPluginId, rebuild } = input
		if (fromPluginId === toPluginId) {
			throw conflict(
				"resources.replace_content_plugin.same_plugin",
				"source and target content plugin must differ",
			)
		}
		// The target must be a healthy plugin — otherwise `getEffectiveEntry`
		// silently resolves to the builtin and we would migrate content onto
		// a plugin that does not own it.
		if (pluginHooks.getEffectiveEntry(toPluginId).id !== toPluginId) {
			throw invalid(
				"resources.replace_content_plugin.unknown_target",
				"target content plugin is not available",
			)
		}
		// Only replace resources the target plugin can actually recognize:
		// each candidate runs its detector first (bounded concurrency), and a
		// rejected (or unreadable) resource stays on the source plugin. For
		// every accepted one, the plugin-id swap + derived-meta clear are one
		// DB transaction, so the operation never leaves an intermediate "id
		// moved but stale metadata still claims the new plugin" state.
		const candidates = repo.listResourcesByContentPluginId(fromPluginId)
		const limiter = createConcurrencyLimiter(REPLACE_DETECT_CONCURRENCY)
		const results = await Promise.all(
			candidates.map((candidate) =>
				limiter.run(async () => {
					const gate = await detectForReplacement(
						candidate.id,
						candidate.fileVersion,
						toPluginId,
					)
					if (!gate.ok) {
						return {
							kind: "failed" as const,
							id: candidate.id,
							reasons: gate.reasons,
						}
					}
					repo.replaceContentPlugin(candidate.id, toPluginId, now())
					await files.clearLocalDerivatives(candidate.id).catch(() => {})
					if (rebuild === "immediate") {
						metaOps.enqueueFullMetaRebuild(candidate.id)
					}
					return { kind: "replaced" as const }
				}),
			),
		)
		const affected = results.filter((r) => r.kind === "replaced").length
		const failures = results
			.filter((r) => r.kind === "failed")
			.map((r) => ({ id: r.id, reasons: r.reasons }))
		return { affected, failures }
	}

	/**
	 * Run the target plugin's detector for one candidate resource. A
	 * rejected detector (or a resource that cannot be read) is treated as
	 * "must not be replaced" — never a hard throw from the bulk operation.
	 */
	async function detectForReplacement(
		id: string,
		fileVersion: number,
		toPluginId: PluginManifestId,
	): Promise<{ readonly ok: boolean; readonly reasons: readonly string[] }> {
		try {
			const api = await access.apiFor(id, fileVersion)
			const result = await pluginHooks.detectForPlugin(api, toPluginId)
			return result.ok
				? { ok: true, reasons: [] }
				: { ok: false, reasons: result.reasons.slice() }
		} catch (err) {
			return {
				ok: false,
				reasons: [
					`resource not accessible: ${err instanceof Error ? err.message : String(err)}`,
				],
			}
		}
	}

	function listContentPluginUsage(): readonly {
		readonly pluginId: string
		readonly count: number
	}[] {
		return repo.listContentPluginUsage()
	}

	async function setCover(
		id: string,
		ext: string,
		data: Buffer,
	): Promise<Resource> {
		repo.findById(id)
		const latestVersion = deps.paths.latestVersion
		await files.writeCover(id, latestVersion, ext, data)
		// Only cover thumbs are stale — the file-list cache describes the
		// archive entries, which a cover change does not touch.
		await files.clearCoverDerivatives(id).catch(() => {})
		repo.patch(id, {
			coverVersion: latestVersion,
			updatedAt: now(),
		})
		metaOps.enqueueCoverMetaRebuild(id)
		return rowToResource(repo.findById(id))
	}

	async function clearCover(id: string): Promise<Resource> {
		repo.findById(id)
		const latestVersion = deps.paths.latestVersion
		await files.deleteCover(id, latestVersion)
		await files.clearCoverDerivatives(id).catch(() => {})
		repo.patch(id, {
			coverVersion: latestVersion,
			updatedAt: now(),
		})
		repo.patchMeta(id, { coverMeta: null }, now())
		metaOps.enqueueCoverMetaRebuild(id)
		return rowToResource(repo.findById(id))
	}

	const MEMORIES_LIMIT = 24

	async function memories(
		input: ResMemoriesInput,
	): Promise<readonly ResCard[]> {
		const rows = repo.memories({
			month: input.month,
			day: input.day,
			offsetMin: input.offsetMin,
			limit: MEMORIES_LIMIT,
		})
		return withCharImageMeta(
			rows.map((row) => withEffectivePlugin(rowToResourceCard(row))),
		)
	}

	function listSourceNames(limit: number): readonly SourceNameCount[] {
		return repo.listSourceNames(limit)
	}

	/**
	 * Dislike click with the same window semantics as comment votes:
	 * a click on a resource whose newest dislike is still inside the 24h
	 * cancel window removes that row; otherwise the click appends a
	 * permanent row.
	 */
	function addDislike(resourceId: string): ResourceDislikeResult {
		const row = repo.findById(resourceId)
		const ts = now()
		const recent = repo.findLatestDislike(resourceId)
		if (
			recent !== undefined &&
			ts - recent.createdAt < RESOURCE_DISLIKE_CANCEL_WINDOW_MS
		) {
			repo.deleteDislike(recent.id)
			recordUserAction("resource.dislike.cancel", row.id, row.name)
			return { action: "cancelled", dislike: undefined }
		}
		const id = newId()
		repo.insertDislike(id, resourceId, ts)
		recordUserAction("resource.dislike.add", row.id, row.name)
		return {
			action: "added",
			dislike: { id, resourceId, createdAt: ts, cancellable: true },
		}
	}

	function listDislikesFor(resourceId: string): readonly ResourceDislike[] {
		repo.findById(resourceId)
		const ts = now()
		return repo.listDislikes(resourceId).map((row) => ({
			id: row.id,
			resourceId: row.resourceId,
			createdAt: row.createdAt,
			cancellable: ts - row.createdAt < RESOURCE_DISLIKE_CANCEL_WINDOW_MS,
		}))
	}

	return {
		list: async (input) => paginateResources(false, input),
		listCards: async (input) => paginateResourceCards(false, input),
		trashList: async (input) => paginateResources(true, input),
		trashListCards: async (input) => paginateResourceCards(true, input),
		detail,
		detailCard: async (id: string): Promise<ResCard> => {
			const row = repo.findCardById(id)
			const dirty = await rebuildMissingMeta(row)
			const hydrated = await withCharImageMeta([
				withEffectivePlugin(
					rowToResourceCard(dirty ? repo.findCardById(id) : row),
				),
			])
			return hydrated[0] ?? withEffectivePlugin(rowToResourceCard(row))
		},
		create,
		update: async (input) => update(input),
		softDelete: async (id) => softDelete(id),
		softDeleteMany,
		restore: async (id) => restore(id),
		hardDelete,
		hardDeleteMany,
		setContentPluginId,
		hasCoverMeta: cover.hasCoverMeta,
		findCover: cover.findCover,
		setCover,
		clearCover,
		hasSourceMeta: async (id) => {
			const row = repo.findById(id)
			return row.sourceMeta !== null
		},
		rebuildPluginMeta: metaOps.rebuildPluginMeta,
		enqueueFullMetaRebuild: metaOps.enqueueFullMetaRebuild,
		enqueueFileStatsRebuild: metaOps.enqueueFileStatsRebuild,
		enqueuePluginMetaRebuild: metaOps.enqueuePluginMetaRebuild,
		enqueueCoverMetaRebuild: metaOps.enqueueCoverMetaRebuild,
		clearAllMeta: repo.clearAllMeta,
		rebuildAllMeta: lockedRebuildAllMeta,
		rebuildCoverMeta: metaOps.rebuildCoverMeta,
		recordCoverMetaFromRenderedThumb: metaOps.recordCoverMetaFromRenderedThumb,
		rebuildResourceFully: metaOps.rebuildResourceFully,
		drainMetaQueue: metaOps.drainQueue,
		listFiles: listResourceFiles,
		listTrashedFiles: async (id: string) =>
			buildTrashedFileList({ paths: deps.paths, pluginHooks, access }, id),
		resolveSourceView: async (id) => {
			const row = repo.findById(id)
			return access.buildView(id, row.fileVersion)
		},
		resolveTrashedSourceView: async (id) =>
			buildTrashedArtifactView(deps.paths, id),
		getContentPluginId: async (id) => {
			const row = repo.findById(id)
			return row.contentPluginId ?? null
		},
		getFileVersion: async (id) => repo.findById(id).fileVersion,
		relatedByTags: async (id, limit) => relatedByTags(id, limit),
		countByContentPluginId: (pluginId) => repo.countByContentPluginId(pluginId),
		replaceContentPlugin,
		listContentPluginUsage,
		memories,
		listSourceNames,
		similarImages: (id) => hashService.similarImages(id),
		similarWithinResource: (id) => hashService.similarWithinResource(id),
		duplicateImages: (id) => hashService.duplicateImages(id),
		imageSearch: (sessionId) => imageSearchById(sessionId),
		imageSearchSessions,
		addDislike: async (resourceId) => addDislike(resourceId),
		listDislikes: async (resourceId) => listDislikesFor(resourceId),
		extractProgress,
		resolveLocalCoverSource,
		probeCache,
	}

	async function relatedByTags(
		id: string,
		limit: number,
	): Promise<readonly ResCard[]> {
		if (limit <= 0) return []
		const seed = repo.findById(id)
		const seedTags = seed.tagIds
		if (seedTags.length === 0) return []
		// Sibling groups count as one tag: both sides collapse to their
		// display tags before the overlap is computed (PRD 5.5).
		const pairs = loadSiblingPairs(deps.db)
		const toDisplay = (tagId: string) => siblingDisplayOf(pairs, tagId) ?? tagId
		const seedDisplays = new Set(seedTags.map(toDisplay))
		const CANDIDATE_CAP = 200
		const { rows } = repo.listCardPage({
			trashed: false,
			query: undefined,
			page: 1,
			size: CANDIDATE_CAP,
			tagIds: [...seedTags],
			tagMode: "or",
			sortBy: "updated",
			order: "desc",
		})
		const scored = rows
			.filter((r) => r.id !== id)
			.map((r) => {
				let overlap = 0
				const seen = new Set<string>()
				for (const tagId of r.tagIds) {
					const display = toDisplay(tagId)
					if (seen.has(display)) continue
					seen.add(display)
					if (seedDisplays.has(display)) overlap++
				}
				return { row: r, overlap }
			})
			.filter((s) => s.overlap > 0)
		scored.sort((a, b) => {
			if (a.overlap !== b.overlap) return b.overlap - a.overlap
			return b.row.updatedAt - a.row.updatedAt
		})
		return withCharImageMeta(
			scored
				.slice(0, limit)
				.map((s) => withEffectivePlugin(rowToResourceCard(s.row))),
		)
	}

	/**
	 * Reverse image search for a session: scan the session's query hashes
	 * across the hash table, then hydrate the ranked matches into cards
	 * (one batched card query, reordered back into scan rank).
	 */
	function imageSearchById(sessionId: string): ImageSearchResult {
		const matches = hashService.similarToQueryHashes(
			imageSearchSessions.loadQueryHashes(sessionId),
		)
		if (matches.length === 0) return { results: [] }
		const ids = matches.map((match) => match.resourceId)
		const { rows } = repo.listCardPage({
			trashed: false,
			query: undefined,
			page: 1,
			size: ids.length,
			ids,
		})
		const cardById = new Map(rows.map((row) => [row.id, row]))
		return {
			results: matches.flatMap((match: QueryHashMatch) => {
				const row = cardById.get(match.resourceId)
				if (row === undefined) return []
				return [
					{
						resource: withEffectivePlugin(rowToResourceCard(row)),
						files: match.files,
					},
				]
			}),
		}
	}
}
