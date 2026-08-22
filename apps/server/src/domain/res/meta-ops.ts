import { extname } from "node:path"
import type { Readable } from "node:stream"
import type { PluginHooks } from "@hoardodile/host"
import type { ThumbInput } from "@hoardodile/host/media"
import {
	probeAudio,
	probeImageSource,
	probeVideo,
	readImageMetadata,
} from "@hoardodile/host/probe"
import { ANIMATED_AREA_DIVISOR, fitInsideArea } from "@hoardodile/host/render"
import type {
	CoverKind,
	CoverMeta,
	FileStats,
	HashesMeta,
	ResourceMetaSnapshot,
	ResourceMetaType,
} from "@hoardodile/schemas"
import { HASHES_META_VERSION } from "@hoardodile/schemas"
import type { ResourceAPI } from "@hoardodile/sdk-server"
import { RESOURCE_COVER_MAX_AREA } from "@hoardodile/sdk-types/resource"
import { RESOURCE_META_REBUILD_CONCURRENCY } from "@hoardodile/shared"
import { createConcurrencyLimiter } from "src/infra/concurrency-limiter.ts"
import { createKeyedTaskQueue } from "src/infra/keyed-task-queue.ts"
import { runStages, type Stage } from "src/infra/pipeline/run-stages.ts"
import { dispatchMediaKind } from "src/infra/thumb/artifact.ts"
import { withViewMediaSource } from "src/infra/thumb/source.ts"
import { extToMediaType } from "src/lib/media-type.ts"
import type { ResRepository, ResRow } from "./repo.ts"
import {
	parseCoverMeta,
	parseFileStats,
	parseHashesMeta,
	parseSearchMeta,
	parseSourceMeta,
} from "./repo.ts"
import { aggregateSourceFiles } from "./source-meta.ts"
import type { SourceArtifactView } from "./source-view.ts"

/**
 * Internal granularity of meta rebuilds. `pluginMeta` is a single compute
 * producing both sourceMeta and searchMeta; the schema-level
 * `ResourceMetaType` only appears in the SSE payload. `hashes` writes
 * the `resource_hashes` table plus the `hashesMeta` marker — it must
 * never join the precache units because hashing decodes every image of
 * the archive.
 */
export type MetaRebuildUnit =
	| "fileStats"
	| "pluginMeta"
	| "coverMeta"
	| "hashes"

/** Every unit — a full meta rebuild (upload commit, plugin switch). */
export const ALL_META_UNITS: readonly MetaRebuildUnit[] = [
	"fileStats",
	"pluginMeta",
	"coverMeta",
	"hashes",
]

/** Units rebuilt before the cover render runs (upload commit, precache). */
export const PRECACHE_META_UNITS: readonly MetaRebuildUnit[] = [
	"fileStats",
	"pluginMeta",
]

/** Narrow shape of the thumb render result this module consumes. */
export type CoverRenderResult =
	| { readonly kind: "ready"; readonly path: string }
	| { readonly kind: "unavailable" }

export type RebuiltResource = {
	/** True when a rendered cover thumb exists for the resource. */
	readonly coverReady: boolean
	/** Fresh `updatedAt` for the thumb URL cache key (one cheap repo read). */
	readonly updatedAt: number
}

export type ResMetaOpsDeps = {
	readonly repo: ResRepository
	readonly now: () => number
	readonly pluginHooks?: PluginHooks
	readonly createResourceAPI: (
		resId: string,
		fileVersion: number,
	) => Promise<ResourceAPI>
	readonly resolveSourceView: (id: string) => Promise<SourceArtifactView>
	readonly findCover: (id: string) => Promise<string | undefined>
	readonly onMetaUpdated?: (
		id: string,
		types: ResourceMetaType[],
		meta: ResourceMetaSnapshot,
	) => void
}

export type ResMetaOps = {
	readonly rebuildMeta: (
		id: string,
		units: readonly MetaRebuildUnit[],
	) => Promise<void>
	readonly rebuildFileStats: (id: string) => Promise<void>
	readonly rebuildPluginMeta: (id: string) => Promise<void>
	readonly rebuildCoverMeta: (id: string) => Promise<void>
	readonly rebuildAllMeta: (id: string) => Promise<void>
	readonly enqueueMetaRebuild: (
		id: string,
		units: readonly MetaRebuildUnit[],
	) => void
	readonly enqueueFileStatsRebuild: (id: string) => void
	readonly enqueuePluginMetaRebuild: (id: string) => void
	readonly enqueueCoverMetaRebuild: (id: string) => void
	readonly enqueueFullMetaRebuild: (id: string) => void
	readonly recordCoverMetaFromRenderedThumb: (
		id: string,
		thumbPath: string,
	) => Promise<void>
	/**
	 * Single-pass rebuild pipeline for one resource (precache per-item
	 * work): one row read, at most one ResourceAPI / SourceArtifactView /
	 * cover-source RPC, then the cover render and the coverMeta write.
	 * `renderCover` is injected so this module stays thumb-service-free.
	 */
	readonly rebuildResourceFully: (
		id: string,
		renderCover: (id: string) => Promise<CoverRenderResult>,
	) => Promise<RebuiltResource>
	/** Wait for all background meta rebuild queues to settle. */
	readonly drainQueue: () => Promise<void>
}

/**
 * Per-resource rebuild context — the IR the meta passes share. The row
 * is read once and the ResourceAPI, SourceArtifactView, and plugin
 * cover-source RPC are lazy + memoized, so a multi-unit rebuild
 * constructs each at most once; `patch` accumulates the pass outputs
 * until the orchestrator merges them into a single applyMetaPatch.
 */
type ResourceProcessContext = {
	readonly id: string
	readonly row: ResRow
	readonly getApi: () => Promise<ResourceAPI>
	readonly getView: () => Promise<SourceArtifactView>
	readonly resolveCoverSource: () => Promise<string | undefined>
	/** Accumulated meta patch fragments, merged once by the runner. */
	readonly patch: Record<string, string | null>
}

export function buildResMetaOps(deps: ResMetaOpsDeps): ResMetaOps {
	const {
		repo,
		now,
		pluginHooks,
		createResourceAPI,
		resolveSourceView,
		findCover,
		onMetaUpdated,
	} = deps

	const fileStatsQueue = createKeyedTaskQueue()
	const pluginMetaQueue = createKeyedTaskQueue()
	const coverMetaQueue = createKeyedTaskQueue()
	const hashesQueue = createKeyedTaskQueue()
	// The keyed queues serialize per resource but not across resources — a
	// cold-start page list can enqueue hundreds of rebuilds at once. Bound
	// the total so they don't stampede the single per-plugin worker.
	const rebuildSlots = createConcurrencyLimiter(
		RESOURCE_META_REBUILD_CONCURRENCY,
	)
	/**
	 * Resources whose hash rebuild is currently running, via either the
	 * background queue or a direct user-path rebuild. A second rebuild of
	 * the same resource (e.g. the user opens the detail page while the
	 * post-commit queue job is still decoding a large gallery) skips —
	 * the running one produces the same rows and marker.
	 */
	const hashesInFlight = new Set<string>()

	// -- Unified patch + notify wrapper --

	function buildMetaSnapshot(
		patch: Record<string, string | null>,
	): ResourceMetaSnapshot {
		const snapshot: ResourceMetaSnapshot = {}
		if ("coverMeta" in patch) {
			snapshot.coverMeta =
				patch.coverMeta === null
					? null
					: (parseCoverMeta(patch.coverMeta) ?? null)
		}
		if ("sourceMeta" in patch) {
			snapshot.sourceMeta =
				patch.sourceMeta === null
					? null
					: (parseSourceMeta(patch.sourceMeta) ?? null)
		}
		if ("searchMeta" in patch) {
			snapshot.searchMeta =
				patch.searchMeta === null
					? null
					: (parseSearchMeta(patch.searchMeta) ?? null)
		}
		if ("fileStats" in patch) {
			snapshot.fileStats =
				patch.fileStats === null
					? null
					: (parseFileStats(patch.fileStats) ?? null)
		}
		if ("hashesMeta" in patch) {
			snapshot.hashesMeta =
				patch.hashesMeta === null
					? null
					: (parseHashesMeta(patch.hashesMeta) ?? null)
		}
		return snapshot
	}

	function applyMetaPatch(
		id: string,
		patch: Record<string, string | null>,
	): void {
		const row = repo.findById(id)
		const actual: Record<string, string | null> = {}
		for (const [key, value] of Object.entries(patch)) {
			if ((row as Record<string, unknown>)[key] !== value) {
				actual[key] = value
			}
		}
		const keys = Object.keys(actual)
		if (keys.length === 0) return
		repo.patchMeta(id, actual, now())
		onMetaUpdated?.(id, keys as ResourceMetaType[], buildMetaSnapshot(actual))
	}

	// -- Rebuild context (shared row + lazy memoized API/view/RPC) --

	function openContext(id: string): ResourceProcessContext {
		const row = repo.findById(id)
		let api: Promise<ResourceAPI> | undefined
		let view: Promise<SourceArtifactView> | undefined
		let coverSource: Promise<string | undefined> | undefined

		function getApi(): Promise<ResourceAPI> {
			api ??= createResourceAPI(id, row.fileVersion)
			return api
		}

		function getView(): Promise<SourceArtifactView> {
			view ??= resolveSourceView(id)
			return view
		}

		async function resolveCoverSourceOnce(): Promise<string | undefined> {
			if (pluginHooks === undefined || row.contentPluginId === null) {
				return undefined
			}
			// Resolve through the effective entry (stored plugin when
			// healthy, builtin fallback otherwise) — matches the read-path
			// resolution in the res service.
			return pluginHooks.resolveLocalCoverSource(
				await getApi(),
				pluginHooks.getEffectiveEntry(row.contentPluginId).id,
			)
		}

		function resolveCoverSource(): Promise<string | undefined> {
			coverSource ??= resolveCoverSourceOnce()
			return coverSource
		}

		return { id, row, getApi, getView, resolveCoverSource, patch: {} }
	}

	// -- Inner compute helpers (pure, no DB writes, no error handling) --

	function thumbnailDims(
		info: { readonly width?: number; readonly height?: number } | undefined,
		animated: boolean,
	): { readonly width: number; readonly height: number } | undefined {
		if (info?.width === undefined || info?.height === undefined)
			return undefined
		const maxArea = animated
			? Math.floor(RESOURCE_COVER_MAX_AREA / ANIMATED_AREA_DIVISOR)
			: RESOURCE_COVER_MAX_AREA
		return fitInsideArea(info.width, info.height, maxArea)
	}

	async function probeCoverDims(
		source: string | Readable,
		ext: string,
	): Promise<{
		readonly width?: number
		readonly height?: number
		readonly kind: ReturnType<typeof extToMediaType>
	}> {
		const kind = extToMediaType(ext)
		return dispatchMediaKind(
			kind,
			{
				video: async () => {
					const info =
						typeof source === "string"
							? await probeVideo(source)
							: await probeVideo(source, ext)
					const dims = thumbnailDims(info, false)
					return { width: dims?.width, height: dims?.height, kind }
				},
				audio: async () => {
					// Audio has no dimensions of its own; whatever cover
					// exists is the artwork embedded in the container.
					const info =
						typeof source === "string"
							? await probeAudio(source)
							: await probeAudio(source, ext)
					const dims = thumbnailDims(info?.coverArt, false)
					return { width: dims?.width, height: dims?.height, kind }
				},
				image: async () => {
					const probe = await probeImageSource(source, ext)
					if (probe === undefined) return { kind }
					const dims = thumbnailDims(probe, probe.animated)
					return { width: dims?.width, height: dims?.height, kind }
				},
			},
			// Other kinds have no decodable cover — report the kind
			// without dimensions (the old image-probe fallthrough landed
			// on the same answer).
			async () => ({ kind }),
		)
	}

	/**
	 * Adapt a cover source entry into a streamable {@link ThumbInput} for
	 * the shared media-source gate. Returns `undefined` when the entry has
	 * no byte range (missing or virtual-without-size).
	 */
	async function streamCoverInput(
		view: SourceArtifactView,
		relPath: string,
	): Promise<ThumbInput | undefined> {
		const range = await view.resolveByteRange(relPath)
		if (range === undefined) return undefined
		return {
			kind: "stream",
			openStream: async () => (await view.openEntryStream(relPath)).stream,
			size: range.size,
		}
	}

	async function computeFileStats(
		ctx: ResourceProcessContext,
	): Promise<Record<string, string | null>> {
		const { row } = ctx
		const partial = await aggregateSourceFiles(await ctx.getView())
		if (partial === undefined) return {}
		const existing = parseFileStats(row.fileStats) ?? {}
		const merged: FileStats = {
			...existing,
			sizeBytes: partial.sizeBytes,
			count: partial.count,
		}
		const nextJson = JSON.stringify(merged)
		return row.fileStats !== nextJson ? { fileStats: nextJson } : {}
	}

	async function computePluginMeta(
		ctx: ResourceProcessContext,
	): Promise<Record<string, string | null>> {
		const { row } = ctx
		if (pluginHooks === undefined || row.contentPluginId === null) return {}
		const meta = await pluginHooks.runMetaHooks(
			await ctx.getApi(),
			row.contentPluginId,
		)
		const patch: Record<string, string | null> = {}

		if (meta.sourceMeta !== undefined && meta.sourceMeta.value !== undefined) {
			const nextJson = JSON.stringify(meta.sourceMeta.value)
			if (row.sourceMeta !== nextJson) patch.sourceMeta = nextJson
		}

		if (meta.searchMeta !== undefined) {
			const nextJson =
				meta.searchMeta.value === undefined
					? null
					: JSON.stringify(meta.searchMeta.value)
			if (row.searchMeta !== nextJson) patch.searchMeta = nextJson
		}

		return patch
	}

	/**
	 * Rebuild the resource's hash rows through the owning plugin's
	 * `imageHashes` hook (effective entry, matching the read-path
	 * resolution). Rows are replaced wholesale; a plugin that provides no
	 * hashes (no permission, no hook, or a hook error) clears the rows and
	 * the marker. Returns the `hashesMeta` patch fragment — the rows
	 * themselves are written directly, outside the meta patch.
	 */
	async function computeHashes(
		ctx: ResourceProcessContext,
	): Promise<Record<string, string | null>> {
		const { row } = ctx
		if (pluginHooks === undefined || row.contentPluginId === null) {
			repo.replaceHashes(row.id, "", [])
			return row.hashesMeta === null ? {} : { hashesMeta: null }
		}
		// Deduplicate against a concurrent rebuild of the same resource
		// (queue job vs direct detail-path rebuild) — one decode pass
		// suffices, and the running one broadcasts the SSE event.
		if (hashesInFlight.has(row.id)) return {}
		hashesInFlight.add(row.id)
		try {
			const effectiveId = pluginHooks.getEffectiveEntry(row.contentPluginId).id
			if (!pluginHooks.supportsImageHashes(effectiveId)) {
				repo.replaceHashes(row.id, effectiveId, [])
				return row.hashesMeta === null ? {} : { hashesMeta: null }
			}
			const result = await pluginHooks.runImageHashes(
				await ctx.getApi(),
				effectiveId,
			)
			const entries =
				result?.hashes.map((hash) => ({
					scope: hash.scope,
					type: hash.type,
					value: hash.value,
					bits: hash.bits ?? null,
				})) ?? []
			repo.replaceHashes(row.id, effectiveId, entries)
			const next = JSON.stringify({
				v: HASHES_META_VERSION,
				pluginVersion: pluginHooks.getEffectiveEntry(row.contentPluginId)
					.manifest.version,
			} satisfies HashesMeta)
			return row.hashesMeta === next ? {} : { hashesMeta: next }
		} finally {
			hashesInFlight.delete(row.id)
		}
	}

	async function probeSourceCover(ctx: ResourceProcessContext): Promise<
		| {
				readonly kind: ReturnType<typeof extToMediaType>
				readonly source: string
				readonly width?: number
				readonly height?: number
		  }
		| undefined
	> {
		const sourceFile = await ctx.resolveCoverSource()
		if (sourceFile === undefined) return undefined
		const ext = extname(sourceFile)

		if (extToMediaType(ext) === "video") {
			const view = await ctx.getView()
			const input = await streamCoverInput(view, sourceFile)
			if (input === undefined) return undefined
			// ISO-BMFF and other seek-dependent containers (.mp4/.mov/.m4v)
			// cannot be probed from a forward-only pipe — ffprobe burns a
			// full probesize read looking for the moov index, then fails.
			// The shared seekable gate materializes the entry instead (one
			// implementation in @hoardodile/host/media via
			// withViewMediaSource).
			const probed = await withViewMediaSource(
				view,
				sourceFile,
				ext,
				"video",
				input,
				(source) => probeCoverDims(source, ext),
			)
			return {
				kind: probed.kind,
				source: sourceFile,
				width: probed.width,
				height: probed.height,
			}
		}

		if (extToMediaType(ext) === "audio") {
			// The only cover an audio file can offer is its embedded
			// artwork; its dimensions come from the same ffprobe pass.
			// `.m4a` is ISO-BMFF, so a pipe read cannot reach the index —
			// probe the materialized entry instead, mirroring the video
			// split above.
			const view = await ctx.getView()
			const input = await streamCoverInput(view, sourceFile)
			if (input === undefined) return undefined
			const probed = await withViewMediaSource(
				view,
				sourceFile,
				ext,
				"audio",
				input,
				(source) => probeCoverDims(source, ext),
			)
			return {
				kind: "audio",
				source: sourceFile,
				width: probed.width,
				height: probed.height,
			}
		}

		// Images probe through a reopenable stream: readImageMetadata then
		// reads only the bytes sharp needs for the header. A raw stream
		// would be buffered whole (capped at THUMB_BUFFER_MAX_BYTES) — every
		// cover probe would read the full entry, and entries beyond the cap
		// would fail to probe at all. The readRange slice makes even the
		// stream read header-only (libvips full-reads non-seekable input).
		const view = await ctx.getView()
		const probe = await probeImageSource(
			{
				openStream: async () => (await view.openEntryStream(sourceFile)).stream,
				readRange: (start, end) => view.readEntrySlice(sourceFile, start, end),
			},
			ext,
		)
		if (probe === undefined) return { kind: "image", source: sourceFile }
		const dims = thumbnailDims(probe, probe.animated)
		return {
			kind: "image",
			source: sourceFile,
			width: dims?.width,
			height: dims?.height,
		}
	}

	async function computeCoverMeta(
		ctx: ResourceProcessContext,
	): Promise<Record<string, string | null>> {
		const sharedCoverPath = await findCover(ctx.id)
		let displayWidth: number | undefined
		let displayHeight: number | undefined
		if (sharedCoverPath !== undefined) {
			const ext = extname(sharedCoverPath)
			const probed = await probeCoverDims(sharedCoverPath, ext)
			displayWidth = probed.width
			displayHeight = probed.height
		}

		const semantics = await probeSourceCover(ctx)
		if (semantics !== undefined) {
			return {
				coverMeta: JSON.stringify({
					width: displayWidth ?? semantics.width,
					height: displayHeight ?? semantics.height,
					kind: semantics.kind,
					source: semantics.source,
				}),
			}
		}

		if (sharedCoverPath !== undefined) {
			return {
				coverMeta: JSON.stringify({
					width: displayWidth,
					height: displayHeight,
					kind: "image",
				}),
			}
		}

		return { coverMeta: JSON.stringify({ empty: true }) }
	}

	// -- Meta passes --

	/**
	 * The four rebuild units as pipeline stages. Each pass computes its
	 * unit's patch fragment into the shared context (the computes stay
	 * pure; the pass only assigns) and knows both row states: plugin-less
	 * rows clear the plugin-produced columns instead of invoking hooks,
	 * while fileStats (plugin-independent aggregation) and coverMeta (a
	 * permanent shared cover applies to any resource) recompute for both.
	 */
	const META_PASSES: Readonly<
		Record<MetaRebuildUnit, Stage<ResourceProcessContext>>
	> = {
		fileStats: {
			label: "fileStats",
			run: async (ctx) => {
				Object.assign(ctx.patch, await computeFileStats(ctx))
			},
		},
		pluginMeta: {
			label: "pluginMeta",
			run: async (ctx) => {
				const { row } = ctx
				if (row.contentPluginId === null) {
					if (row.sourceMeta !== null) ctx.patch.sourceMeta = null
					if (row.searchMeta !== null) ctx.patch.searchMeta = null
					return
				}
				Object.assign(ctx.patch, await computePluginMeta(ctx))
			},
		},
		coverMeta: {
			label: "coverMeta",
			run: async (ctx) => {
				Object.assign(ctx.patch, await computeCoverMeta(ctx))
			},
		},
		hashes: {
			label: "hashes",
			run: async (ctx) => {
				const { row } = ctx
				if (row.contentPluginId === null) {
					repo.replaceHashes(row.id, "", [])
					if (row.hashesMeta !== null) ctx.patch.hashesMeta = null
					return
				}
				Object.assign(ctx.patch, await computeHashes(ctx))
			},
		},
	}

	// -- Single rebuild orchestrator --

	/**
	 * Rebuild the requested units for one resource. The row is read once
	 * (via the context), the unit passes run concurrently — each with its
	 * own error isolation (runStages) — and all changes land in a single
	 * merged applyMetaPatch (hence a single onMetaUpdated broadcast). The
	 * outer RESOURCE_META_REBUILD_CONCURRENCY limiter bounds how many
	 * resources rebuild at once; within a resource the units share the
	 * memoized context, so concurrency only overlaps their latencies (zip
	 * probing, worker RPC, cover probing).
	 */
	async function runMetaRebuild(
		ctx: ResourceProcessContext,
		units: readonly MetaRebuildUnit[],
	): Promise<void> {
		const { id } = ctx
		await runStages(
			units.map((unit) => META_PASSES[unit]),
			ctx,
			{
				parallel: true,
				onStageError: (label, err) =>
					console.warn(
						`[meta-ops] ${label} for ${id}: ${err instanceof Error ? err.message : String(err)}`,
					),
			},
		)
		applyMetaPatch(id, ctx.patch)
	}

	async function rebuildMeta(
		id: string,
		units: readonly MetaRebuildUnit[],
	): Promise<void> {
		await runMetaRebuild(openContext(id), units)
	}

	async function rebuildFileStats(id: string): Promise<void> {
		await rebuildMeta(id, ["fileStats"])
	}

	async function rebuildPluginMeta(id: string): Promise<void> {
		await rebuildMeta(id, ["pluginMeta"])
	}

	async function rebuildCoverMeta(id: string): Promise<void> {
		await rebuildMeta(id, ["coverMeta"])
	}

	async function rebuildAllMeta(id: string): Promise<void> {
		await rebuildMeta(id, ALL_META_UNITS)
	}

	// -- Unified coverMeta write path --

	/**
	 * The single coverMeta writer: every direct coverMeta write goes
	 * through applyMetaPatch so change-detection and the onMetaUpdated
	 * broadcast stay uniform. (Unit computes above return patch fragments
	 * that funnel into the same applyMetaPatch via runMetaRebuild.)
	 */
	function writeCoverMeta(
		ctx: ResourceProcessContext,
		meta: {
			readonly width?: number
			readonly height?: number
			readonly kind: CoverKind
			readonly source?: string
		},
	): void {
		applyMetaPatch(ctx.id, {
			coverMeta: JSON.stringify({
				width: meta.width,
				height: meta.height,
				kind: meta.kind,
				source: meta.source,
			} satisfies CoverMeta),
		})
	}

	/**
	 * Fast path after a cover render: read the dims back from the rendered
	 * thumb instead of re-probing the source. A permanent shared cover
	 * still wins (kind stays "image", no source); otherwise kind/source
	 * come from the (memoized) plugin cover-source resolution — audio
	 * included, since a rendered thumb for an audio source is its
	 * embedded artwork and the card still owns the audio affordances.
	 */
	async function recordCoverMetaFromThumb(
		ctx: ResourceProcessContext,
		thumbPath: string,
	): Promise<void> {
		const { meta } = await readImageMetadata(thumbPath, extname(thumbPath))
		if (meta.width === undefined || meta.height === undefined) {
			return
		}

		const sharedCoverPath = await findCover(ctx.id)
		let kind: CoverKind = "image"
		let source: string | undefined

		if (sharedCoverPath === undefined) {
			source = await ctx.resolveCoverSource()
			if (source !== undefined) kind = extToMediaType(extname(source))
		}

		writeCoverMeta(ctx, {
			width: meta.width,
			height: meta.height,
			kind,
			source,
		})
	}

	async function recordCoverMetaFromRenderedThumb(
		id: string,
		thumbPath: string,
	): Promise<void> {
		await recordCoverMetaFromThumb(openContext(id), thumbPath)
	}

	// -- Single-pass per-resource pipeline (precache) --

	async function rebuildResourceFully(
		id: string,
		renderCover: (id: string) => Promise<CoverRenderResult>,
	): Promise<RebuiltResource> {
		const ctx = openContext(id)
		await runMetaRebuild(ctx, PRECACHE_META_UNITS)
		const cover = await renderCover(id)
		if (cover.kind === "ready") {
			await recordCoverMetaFromThumb(ctx, cover.path)
		} else {
			await runMetaRebuild(ctx, ["coverMeta"])
		}
		return {
			coverReady: cover.kind === "ready",
			updatedAt: repo.findById(id).updatedAt,
		}
	}

	// -- Enqueue wrappers --

	/**
	 * Cooldown after a failed background rebuild before the same unit is
	 * re-enqueued. Without it, a degraded plugin worker turns every list
	 * page into a retry storm (each failed rebuild re-marks the meta
	 * missing, and the next page view enqueues it again).
	 */
	const FAILED_REBUILD_COOLDOWN_MS = 30_000
	/** `id:unit` → timestamp of the last failed background rebuild. */
	const rebuildFailures = new Map<string, number>()

	function unitStillMissing(row: ResRow, unit: MetaRebuildUnit): boolean {
		if (unit === "fileStats") return row.fileStats === null
		if (unit === "pluginMeta")
			// `&&`: a plugin without a searchMeta hook legitimately leaves
			// searchMeta null — only a fully-unproduced unit is a failure.
			return row.sourceMeta === null && row.searchMeta === null
		if (unit === "hashes") {
			// Legitimately empty (plugin provides none / produced none) is
			// still a computed state — only the marker being absent means
			// the rebuild never completed.
			return row.hashesMeta === null
		}
		// coverMeta null means the unit has not been computed. `{ empty:
		// true }` is a successful computed result (no cover source).
		return false
	}

	function queueFor(unit: MetaRebuildUnit) {
		switch (unit) {
			case "fileStats":
				return fileStatsQueue
			case "pluginMeta":
				return pluginMetaQueue
			case "coverMeta":
				return coverMetaQueue
			case "hashes":
				return hashesQueue
		}
	}

	function enqueueMetaRebuild(
		id: string,
		units: readonly MetaRebuildUnit[],
	): void {
		for (const unit of units) {
			const failureKey = `${id}:${unit}`
			const lastFailure = rebuildFailures.get(failureKey)
			if (
				lastFailure !== undefined &&
				now() - lastFailure < FAILED_REBUILD_COOLDOWN_MS
			) {
				// Back off after repeated failures — the queue drains on its
				// own once the worker recovers and a later enqueue succeeds.
				continue
			}
			queueFor(unit).enqueue(id, () =>
				rebuildSlots
					.run(async () => {
						await runMetaRebuild(openContext(id), [unit])
						// Success = the unit's meta is no longer missing
						// (coverMeta: not null — populated or empty sentinel).
						if (unitStillMissing(repo.findById(id), unit)) {
							rebuildFailures.set(failureKey, now())
						} else {
							rebuildFailures.delete(failureKey)
						}
					})
					.catch((err) => {
						rebuildFailures.set(failureKey, now())
						console.warn(
							`[meta-ops] ${unit} rebuild for ${id} failed: ${err instanceof Error ? err.message : String(err)}`,
						)
					}),
			)
		}
	}

	function enqueueFileStatsRebuild(id: string): void {
		enqueueMetaRebuild(id, ["fileStats"])
	}

	function enqueuePluginMetaRebuild(id: string): void {
		enqueueMetaRebuild(id, ["pluginMeta"])
	}

	function enqueueCoverMetaRebuild(id: string): void {
		enqueueMetaRebuild(id, ["coverMeta"])
	}

	function enqueueFullMetaRebuild(id: string): void {
		enqueueMetaRebuild(id, ALL_META_UNITS)
	}

	async function drainQueue(): Promise<void> {
		await Promise.all([
			fileStatsQueue.drain(),
			pluginMetaQueue.drain(),
			coverMetaQueue.drain(),
			hashesQueue.drain(),
		])
	}

	return {
		rebuildMeta,
		rebuildFileStats,
		rebuildPluginMeta,
		rebuildCoverMeta,
		rebuildAllMeta,
		enqueueMetaRebuild,
		enqueueFileStatsRebuild,
		enqueuePluginMetaRebuild,
		enqueueCoverMetaRebuild,
		enqueueFullMetaRebuild,
		recordCoverMetaFromRenderedThumb,
		rebuildResourceFully,
		drainQueue,
	}
}
