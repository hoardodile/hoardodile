/**
 * Measurement core + plugin wiring shared by the backend benchmark suites.
 *
 * The suites measure whole pipelines (upload, precache sweep, plugin RPC)
 * with realistic corpora, adaptive concurrency, and cold-cache rituals —
 * tinybench-style iteration micro-benchmarks do not fit that shape, so the
 * measurement stays hand-rolled here (`runPhase`) and the micro suites
 * (`suites/io-micro.ts`, `suites/db.ts`) adapt their per-task results into
 * the report contract instead.
 *
 * Owns:
 *   - deterministic corpus helpers (mulberry32, randomBytes, buildZipBuffer)
 *   - the page-driven phase runner (runPhase) + stats/formatting helpers
 *   - plugin hook wiring (stub vs real) for the suites that need services
 *   - the RPC invoke counters (countHooks) and detect-timing wrapper
 *   - cross-suite dedupes: hooksFactoryFor, createBenchApp, runReps,
 *     createIdPageLoader, metric helpers, tinybench report collection
 *
 * Report + baseline handling lives in `report.ts`; flag parsing and the
 * suite module contract live in `args.ts`.
 */
import { existsSync, rmSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import {
	buildRegistry,
	createPluginHooks,
	createPluginLoader,
	createPluginSandbox,
	DEFAULT_SANDBOX_CONFIG,
	type PluginHooks,
	type PluginRegistryEntry,
} from "@hoardodile/host"
import type { ResourceAPI } from "@hoardodile/sdk-server"
import { extname, naturalSort } from "@hoardodile/sdk-server/helpers"
import {
	AUDIO_EXTS,
	IMAGE_EXTS,
	VIDEO_EXTS,
} from "@hoardodile/sdk-types/media-exts"
import type { ListPageResult } from "@hoardodile/shared"
import { createResourceService } from "src/domain/res/service.ts"
import { buildResourceUploads } from "src/domain/res/upload.ts"
import type { AdaptiveConcurrency } from "src/infra/adaptive-concurrency.ts"
import { openDb, type SqliteDb } from "src/infra/db/connection.ts"
import {
	createStoragePaths,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import yazl from "yazl"
import type { CommonArgs } from "./args.ts"
import type { BenchMetric } from "./report.ts"

export const REPO_ROOT = resolve(
	dirname(fileURLToPath(import.meta.url)),
	"../../..",
)
export const BUILTIN_PLUGIN_DIST = join(REPO_ROOT, "plugins/file/dist")

// ── Deterministic corpus helpers ──────────────────────────────────────────

/** Deterministic PRNG so corpus bytes are reproducible across runs. */
export function mulberry32(seed: number): () => number {
	let a = seed
	return function next() {
		a |= 0
		a = (a + 0x6d2b79f5) | 0
		let t = Math.imul(a ^ (a >>> 15), 1 | a)
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296
	}
}

export function randomBytes(seed: number, size: number): Buffer {
	const rand = mulberry32(seed)
	const buf = Buffer.allocUnsafe(size)
	for (let i = 0; i < size; i++) {
		buf[i] = Math.floor(rand() * 256)
	}
	return buf
}

/** Build a zip in memory (STORED unless `compress`), e.g. for archive uploads. */
export async function buildZipBuffer(
	entries: readonly (readonly [string, Buffer])[],
	compress: boolean,
): Promise<Buffer> {
	const zip = new yazl.ZipFile()
	for (const [name, data] of entries) {
		zip.addBuffer(data, name, { compress })
	}
	zip.end()
	const chunks: Buffer[] = []
	for await (const chunk of zip.outputStream) {
		chunks.push(typeof chunk === "string" ? Buffer.from(chunk) : chunk)
	}
	return Buffer.concat(chunks)
}

// ── Detect-timing wrapper ─────────────────────────────────────────────────

export type DetectTiming = ReturnType<typeof withDetectTiming>

/** Wrap the hooks facade so `detectFirstMatch` wall time accumulates — the plugin cost inside `resource.create` that cannot be timed from outside. */
export function withDetectTiming(hooks: PluginHooks): {
	hooks: PluginHooks
	reset: () => void
	detectMs: () => number
} {
	let acc = 0
	const wrapped: PluginHooks = {
		...hooks,
		detectFirstMatch: async (api) => {
			const t0 = performance.now()
			try {
				return await hooks.detectFirstMatch(api)
			} finally {
				acc += performance.now() - t0
			}
		},
	}
	return {
		hooks: wrapped,
		reset: () => {
			acc = 0
		},
		detectMs: () => acc,
	}
}

// ── Phase driver ─────────────────────────────────────────────────────────

export type StepTimings = Record<string, number>

export type PhaseResult = {
	wallMs: number
	items: number
	succeeded: number
	failed: number
	errors: { id: string; error: string }[]
	stepMs: StepTimings
	perItemMs: { mean: number; p95: number; min: number; max: number }
	itemsPerSec: number
	/** Peak host RSS observed while the phase ran. */
	memoryPeakMb: number
}

export function summarizeSamples(samples: readonly number[]) {
	if (samples.length === 0) return { mean: 0, p95: 0, min: 0, max: 0 }
	const sorted = [...samples].sort((a, b) => a - b)
	const mean = samples.reduce((acc, v) => acc + v, 0) / samples.length
	const p95idx = Math.min(
		sorted.length - 1,
		Math.ceil(0.95 * sorted.length) - 1,
	)
	return {
		mean,
		p95: sorted[p95idx] ?? 0,
		min: sorted[0] ?? 0,
		max: sorted[sorted.length - 1] ?? 0,
	}
}

export type TimedFn = <T>(step: string, fn: () => Promise<T>) => Promise<T>

/**
 * Page-driven phase runner with the same adaptive concurrency as
 * production requests. Per-item step timings are aggregated into `stepMs`
 * (sums exceed wall time under concurrency — that is expected; they show
 * where CPU/IO effort goes).
 */
export async function runPhase<T extends { id: string }>(
	loadPage: (page: number) => Promise<ListPageResult<T>>,
	processItem: (item: T, timed: TimedFn) => Promise<void>,
	concurrency: AdaptiveConcurrency,
	label: string,
): Promise<PhaseResult> {
	const stepMs: StepTimings = {}
	const perItem: number[] = []
	const errors: { id: string; error: string }[] = []
	let succeeded = 0
	let failed = 0
	let processed = 0
	let peakRss = 0

	async function timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
		const t0 = performance.now()
		try {
			return await fn()
		} finally {
			stepMs[step] = (stepMs[step] ?? 0) + (performance.now() - t0)
		}
	}

	const wallStart = performance.now()
	let page = 1
	for (;;) {
		const list = await loadPage(page)
		const promises = list.rows.map(async (item) => {
			const release = await concurrency.acquire()
			try {
				const t0 = performance.now()
				await processItem(item, timed)
				perItem.push(performance.now() - t0)
				succeeded++
			} catch (err) {
				failed++
				errors.push({
					id: item.id,
					error: err instanceof Error ? err.message : String(err),
				})
			} finally {
				release()
			}
			peakRss = Math.max(peakRss, process.memoryUsage().rss)
			processed++
			if (processed % 50 === 0) {
				console.log(`    [${label}] ${processed}/${list.total} processed`)
			}
		})
		await Promise.allSettled(promises)
		page++
		if (list.rows.length === 0 || page > 1000) break
	}
	const wallMs = performance.now() - wallStart

	return {
		wallMs,
		items: succeeded + failed,
		succeeded,
		failed,
		errors: errors.slice(0, 10),
		stepMs,
		perItemMs: summarizeSamples(perItem),
		itemsPerSec: wallMs > 0 ? (succeeded / wallMs) * 1000 : 0,
		memoryPeakMb: roundMb(peakRss),
	}
}

// ── Plugin hook wiring (stub vs real) ─────────────────────────────────────

export type BenchHooks = {
	readonly hooks: PluginHooks
	/** Id of the plugin seeded resources should be assigned to. */
	readonly contentPluginId: string
	/**
	 * Reload the plugin registry (real mode only; `undefined` in stub
	 * mode). Used by the plugin suite's `--churn` phase to race rescans
	 * against live hook invocations.
	 */
	readonly rescan?: () => Promise<void>
	readonly teardown: () => Promise<void>
}

export type HooksFactory = (ctx: {
	readonly db: SqliteDb
	readonly paths: StoragePaths
}) => Promise<BenchHooks>

/**
 * Bench-local in-process plugin matching the builtin file plugin's
 * contract (detect always ok, sourceMeta = file count, listFiles via
 * natural sort) plus a `coverLocal` picking the first media entry — the
 * precache suites need a cover source to exercise the render pipeline,
 * and the real file plugin ships without one. No image probing: probe
 * work is measured by the precache bench against real bytes, not here.
 */
export const BENCH_STUB_PLUGIN_ID = "1b2c3d4e-1db6-48f5-9d53-1008b8cb84c3"

function createFileStubPlugin(): NonNullable<PluginRegistryEntry["plugin"]> {
	return {
		detect: async () => ({ ok: true }) as const,
		sourceMeta: async (api: ResourceAPI) => {
			const files = await api.listFileNames()
			return { fileCount: files.length }
		},
		coverLocal: async (api: ResourceAPI) => {
			const files = await api.listFileNames()
			for (const filename of naturalSort(files)) {
				const ext = extname(filename)
				if (IMAGE_EXTS.has(ext) || VIDEO_EXTS.has(ext)) return filename
			}
			return undefined
		},
		listFiles: async (api: ResourceAPI) => {
			const files = await api.listFileNames()
			return naturalSort(files).map((filename) => {
				const ext = extname(filename)
				const type = IMAGE_EXTS.has(ext)
					? ("image" as const)
					: VIDEO_EXTS.has(ext)
						? ("video" as const)
						: AUDIO_EXTS.has(ext)
							? ("audio" as const)
							: undefined
				return type === undefined ? filename : { filename, type }
			})
		},
	}
}

/** In-process hooks facade over the file-contract stub plugin. */
export async function createFileStubHooks(): Promise<BenchHooks> {
	const entry: PluginRegistryEntry = {
		id: BENCH_STUB_PLUGIN_ID,
		manifest: {
			id: BENCH_STUB_PLUGIN_ID,
			name: "Bench File Stub",
			description: "In-process no-probe file-contract stub",
			version: "1.0.0",
			permissions: {
				sourceMeta: true,
				searchMeta: false,
				danmaku: false,
				message: false,
				imageHashes: false,
				container: false,
				download: false,
			},
		},
		enabled: true,
		priority: Number.MAX_SAFE_INTEGER,
		pinned: false,
		color: "",
		missing: false,
		builtin: true,
		dev: false,
		plugin: createFileStubPlugin(),
	}
	const hooks = createPluginHooks({ getRegistry: () => buildRegistry([entry]) })
	return {
		hooks,
		contentPluginId: BENCH_STUB_PLUGIN_ID,
		teardown: async () => {},
	}
}

/**
 * Production plugin wiring without Fastify — same construction order as
 * the server: sandbox worker host, loader (builtin file plugin plus any
 * dev plugin dirs), then the hooks facade over the live registry.
 * `onTiming` receives the loader's loadAll step durations ("dispose",
 * "seed", "discover", "activate") for boot-cost diagnostics.
 */
export async function createRealHooks(
	ctx: { readonly db: SqliteDb; readonly paths: StoragePaths },
	devPluginDirs: readonly string[] = [],
	onTiming?: (step: string, ms: number) => void,
): Promise<BenchHooks> {
	const sandbox = createPluginSandbox({ ...DEFAULT_SANDBOX_CONFIG })
	const loader = createPluginLoader({
		builtinDir: BUILTIN_PLUGIN_DIST,
		devPluginDirs,
		pluginsDir: ctx.paths.atVersion(ctx.paths.activeVersion).plugins(),
		// The bench never records plugin settings; an empty store behaves
		// like a fresh install.
		settings: {
			get: () => undefined,
			all: () => [],
		},
		sandbox,
		onTiming,
	})
	await loader.loadAll()
	const hooks = createPluginHooks({ getRegistry: () => loader.getRegistry() })
	// Seed resources against the dev plugin when one is given (it matches
	// first in detect order), otherwise the builtin file plugin — so real
	// mode always invokes a registered, sandboxed hook target.
	const registry = loader.getRegistry()
	const devPlugin = registry.getEnabled().find((e) => !e.builtin)
	return {
		hooks,
		contentPluginId:
			devPlugin?.id ?? registry.getBuiltin()?.id ?? BENCH_STUB_PLUGIN_ID,
		rescan: async () => {
			await loader.rescan()
		},
		teardown: () => sandbox.disposeAll(),
	}
}

export function assertPluginDist(dir: string, buildHint: string): void {
	if (
		!existsSync(join(dir, "manifest.json")) ||
		!existsSync(join(dir, "main.js"))
	) {
		throw new Error(
			`--plugins=real needs a built plugin at ${dir} — ${buildHint}`,
		)
	}
}

/** Guard real mode: the builtin file plugin (and any `--plugin` dir) must be built. */
export function assertRealPluginDists(common: CommonArgs): void {
	if (common.plugins !== "real") return
	assertPluginDist(
		BUILTIN_PLUGIN_DIST,
		"run `pnpm build` first (turbo builds plugins/file for the bench task)",
	)
	if (common.plugin !== undefined) {
		assertPluginDist(
			common.plugin,
			"build the plugin first (`pnpm build:pkgs` for in-repo plugins, or the plugin's own build for external dists)",
		)
	}
}

export type SuiteHookWiring = {
	readonly factory: HooksFactory
	/**
	 * The detect-timing wrapper installed on the last factory invocation
	 * (present when `opts.wrap === "detect"`; undefined before seeding).
	 */
	readonly detectTiming: () => DetectTiming | undefined
	/**
	 * The RPC-call counter installed on the last factory invocation
	 * (present when `opts.wrap === "count"`; undefined before seeding).
	 */
	readonly counter: () => HookCounter | undefined
}

/**
 * Build the per-tier hooks factory for a suite's `--plugins=` mode.
 * `wrap: "detect"` installs the detect-timing wrapper on both stub and
 * real hooks (io/plugin suites); `wrap: "count"` installs the invoke
 * counter on real hooks only (precache — stub mode runs unwrapped).
 */
export function hooksFactoryFor(
	common: CommonArgs,
	opts: {
		readonly onTiming?: (step: string, ms: number) => void
		readonly wrap?: "detect" | "count"
	} = {},
): SuiteHookWiring {
	let detectTiming: DetectTiming | undefined
	let counter: HookCounter | undefined
	const factory: HooksFactory = async (ctx) => {
		const benchHooks =
			common.plugins === "real"
				? await createRealHooks(
						ctx,
						common.plugin === undefined ? [] : [common.plugin],
						opts.onTiming,
					)
				: await createFileStubHooks()
		let hooks = benchHooks.hooks
		if (opts.wrap === "detect") {
			detectTiming = withDetectTiming(hooks)
			hooks = detectTiming.hooks
		} else if (opts.wrap === "count" && common.plugins === "real") {
			counter = countHooks(hooks)
			hooks = counter.hooks
		}
		return {
			hooks,
			contentPluginId: benchHooks.contentPluginId,
			rescan: benchHooks.rescan,
			teardown: benchHooks.teardown,
		}
	}
	return {
		factory,
		detectTiming: () => detectTiming,
		counter: () => counter,
	}
}

/**
 * The service stack io/plugin suites seed per tier: in-memory DB with
 * migrations, storage paths, uploads and the resource service, wired
 * over the hooks produced by `hooksFactory`.
 */
export async function createBenchApp(
	root: string,
	hooksFactory: HooksFactory,
): Promise<{
	readonly db: SqliteDb
	readonly paths: StoragePaths
	readonly uploads: ReturnType<typeof buildResourceUploads>
	readonly res: ReturnType<typeof createResourceService>
	readonly contentPluginId: string
	readonly rescan?: () => Promise<void>
	readonly teardown: () => Promise<void>
}> {
	const dbh = openDb(":memory:")
	dbh.runMigrations()
	const paths = createStoragePaths({ root })
	const benchHooks = await hooksFactory({ db: dbh.db, paths })
	const uploads = buildResourceUploads(
		paths,
		{ maxArchiveExtractedBytes: 1_073_741_824 },
		{ current: false },
	)
	const res = createResourceService({
		db: dbh.db,
		paths,
		pluginHooks: benchHooks.hooks,
		uploads,
		readOnly: { current: false },
	})
	return {
		db: dbh.db,
		paths,
		uploads,
		res,
		contentPluginId: benchHooks.contentPluginId,
		rescan: benchHooks.rescan,
		teardown: benchHooks.teardown,
	}
}

// ── Hook invoke counters (the RPC proxy) ──────────────────────────────────

export type HookMethodStats = { calls: number; ms: number }

export type HookSnapshot = {
	readonly totalCalls: number
	readonly totalMs: number
	readonly byMethod: Record<string, HookMethodStats>
}

export type HookCounter = ReturnType<typeof countHooks>

/**
 * Wrap a PluginHooks facade with per-method call counts and wall time.
 * The countable proxy for sandbox RPC: each hook invoke is one worker
 * message round-trip, plus two messages per ResourceAPI call the hook
 * makes inside the worker.
 */
export function countHooks(hooks: PluginHooks): {
	readonly hooks: PluginHooks
	readonly reset: () => void
	readonly snapshot: () => HookSnapshot
} {
	let byMethod: Record<string, HookMethodStats> = {}

	function wrap<A extends unknown[], R>(
		method: string,
		fn: (...args: A) => Promise<R>,
	): (...args: A) => Promise<R> {
		return async (...args: A) => {
			const t0 = performance.now()
			try {
				return await fn(...args)
			} finally {
				const stats = byMethod[method] ?? { calls: 0, ms: 0 }
				byMethod[method] = stats
				stats.calls++
				stats.ms += performance.now() - t0
			}
		}
	}

	const wrapped: PluginHooks = {
		defaultPluginId: hooks.defaultPluginId,
		getEffectiveEntry: hooks.getEffectiveEntry,
		detectFirstMatch: wrap("detectFirstMatch", hooks.detectFirstMatch),
		revalidate: wrap("revalidate", hooks.revalidate),
		detectForPlugin: wrap("detectForPlugin", hooks.detectForPlugin),
		detectForImportDir: wrap("detectForImportDir", hooks.detectForImportDir),
		buildFileList: wrap("buildFileList", hooks.buildFileList),
		resolveLocalCoverSource: wrap(
			"resolveLocalCoverSource",
			hooks.resolveLocalCoverSource,
		),
		runMetaHooks: wrap("runMetaHooks", hooks.runMetaHooks),
		supportsImageHashes: hooks.supportsImageHashes,
		runImageHashes: wrap("runImageHashes", hooks.runImageHashes),
		runInstallHook: hooks.runInstallHook,
	}

	return {
		hooks: wrapped,
		reset: () => {
			byMethod = {}
		},
		snapshot: () => {
			let totalCalls = 0
			let totalMs = 0
			for (const stats of Object.values(byMethod)) {
				totalCalls += stats.calls
				totalMs += stats.ms
			}
			return { totalCalls, totalMs, byMethod }
		},
	}
}

// ── Stats + formatting ────────────────────────────────────────────────────

export type MetricSummary = {
	readonly median: number
	readonly min: number
	readonly max: number
}

export function summarizeMetric(values: readonly number[]): MetricSummary {
	const sorted = [...values].sort((a, b) => a - b)
	return {
		median: sorted[Math.floor(sorted.length / 2)] ?? 0,
		min: sorted[0] ?? 0,
		max: sorted[sorted.length - 1] ?? 0,
	}
}

export function fmtMs(ms: number): string {
	return ms >= 1000 ? `${(ms / 1000).toFixed(2)}s` : `${ms.toFixed(1)}ms`
}

export function fmtMetric(m: MetricSummary, unit: "ms" | "/s"): string {
	if (unit === "/s") {
		return `${m.median.toFixed(2)}/s [${m.min.toFixed(2)}–${m.max.toFixed(2)}]`
	}
	return `${fmtMs(m.median)} [${fmtMs(m.min)}–${fmtMs(m.max)}]`
}

/** RSS bytes → MB rounded to one decimal, the report's memory convention. */
export function roundMb(bytes: number): number {
	return Math.round((bytes / 1024 / 1024) * 10) / 10
}

/** Wrap a MetricSummary as a gate-comparable BenchMetric. */
export function metricFromSummary(
	name: string,
	unit: BenchMetric["unit"],
	summary: MetricSummary,
): BenchMetric {
	return {
		name,
		unit,
		median: summary.median,
		min: summary.min,
		max: summary.max,
	}
}

/** Peak phase memory across a suite's reps, rounded to the report convention. */
export function maxPhaseMemory(phases: readonly PhaseResult[]): number {
	let max = 0
	for (const p of phases) max = Math.max(max, p.memoryPeakMb)
	return Math.round(max * 10) / 10
}

/** tinybench 6 result statistics — the fields the report consumes. */
type LatencyStats = {
	readonly p50: number
	readonly mean: number
	readonly p99: number
	readonly min: number
	readonly max: number
}

function isLatencyStats(value: unknown): value is LatencyStats {
	return (
		typeof value === "object" &&
		value !== null &&
		"p50" in value &&
		"mean" in value &&
		"p99" in value &&
		"min" in value &&
		"max" in value
	)
}

/**
 * Collect tinybench task results into report metrics, printing the
 * per-task median line as the micro suites do. Tasks that produced no
 * latency statistics (tinybench 6 records state-tagged results: errored,
 * not started, aborted without statistics) are printed and skipped instead
 * of crashing the report.
 */
export function summarizeBenchTasks(
	tasks: readonly {
		readonly name: string
		readonly result?: unknown
	}[],
): BenchMetric[] {
	const metrics: BenchMetric[] = []
	for (const task of tasks) {
		const raw = task.result
		let stats: LatencyStats | undefined
		if (typeof raw === "object" && raw !== null && "latency" in raw) {
			const latency = raw.latency
			if (isLatencyStats(latency)) stats = latency
		}
		if (stats === undefined) {
			console.log(`  ${task.name.padEnd(24)} ERROR (no samples)`)
			continue
		}
		metrics.push({
			name: task.name,
			unit: "ms",
			median: stats.p50,
			min: stats.min,
			max: stats.max,
		})
		console.log(
			`  ${task.name.padEnd(24)} median ${stats.p50.toFixed(3)}ms | mean ${stats.mean.toFixed(3)}ms | p99 ${stats.p99.toFixed(3)}ms | min ${stats.min.toFixed(3)}ms`,
		)
	}
	return metrics
}

// ── Page loader + rep driver ──────────────────────────────────────────────

/** Page the read phases over a fixed id list, like the suites' manual loaders. */
export function createIdPageLoader(
	ids: readonly string[],
	pageSize = 200,
): (page: number) => Promise<ListPageResult<{ readonly id: string }>> {
	return (page) => {
		const start = (page - 1) * pageSize
		return Promise.resolve({
			rows: ids.slice(start, start + pageSize).map((id) => ({ id })),
			total: ids.length,
			page,
			size: pageSize,
		})
	}
}

/**
 * Run the `repeat` reps of one tier over a seeded corpus, printing the
 * rep banner and always tearing the corpus down (teardown + root rm).
 */
export async function runReps<T>(
	seeded: { readonly root: string; readonly teardown: () => Promise<void> },
	label: string,
	repeat: number,
	runRep: () => Promise<T>,
): Promise<readonly T[]> {
	const reps: T[] = []
	try {
		for (let rep = 1; rep <= repeat; rep++) {
			console.log(`=== ${label} — rep ${rep}/${repeat} ===`)
			reps.push(await runRep())
		}
	} finally {
		await seeded.teardown()
		rmSync(seeded.root, { recursive: true, force: true })
	}
	return reps
}
