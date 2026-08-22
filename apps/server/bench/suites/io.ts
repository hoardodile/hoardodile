/**
 * IO benchmark suite: upload + read pipelines. See the CLI dispatcher
 * (bench/cli.ts) for usage; this module declares its flags table-driven
 * and returns a report.
 *
 * Plugin modes (`--plugins=`):
 *   stub (default) — bench-local in-process file-contract plugin (see
 *     harness.ts createFileStubHooks): real CD parse and zip IO, but NO
 *     image probing and NO worker sandbox, keeping IO attribution clean.
 *   real — production plugin wiring: sandbox worker + loader + the real
 *     builtin file plugin (must be built; the bench errors with a hint
 *     otherwise). Measures the per-resource RPC cost (detect round-trip,
 *     listFiles with statFiles round-trips). `--plugin=<dist-dir>` adds
 *     a dev plugin dist; it becomes the content plugin when its detector
 *     matches first.
 *
 * Corpus (`--tiers=` resources, `--files=` per resource, `--bytes=` per
 * file): all files share one pseudo-random buffer (incompressible bytes;
 * the file plugin's hooks only stat entries, so no decodable content is
 * needed); uploads happen fresh in every rep (stage + commit are the
 * measured work). `--pool-noise=N` stages N decoy files per resource that
 * stay in the staging pool, to measure the pool-directory scan cost of
 * fileId resolution at commit time.
 *
 * Repeats (`--repeat=N`, default 3): each tier is seeded ONCE (storage
 * root + DB + buffer), then upload + read rituals run N times on it. The
 * read ritual starts from a cold cache state (rm local/cache/resources +
 * zip CD cache clear), so rep 1 is no different from rep N — paired
 * configurations get identical treatment. Upload phases run sequentially
 * (staging writes + commit are per-resource); read phases use the same
 * adaptive concurrency as production requests.
 */
import { mkdtempSync } from "node:fs"
import { rm } from "node:fs/promises"
import os, { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import type { createResourceService } from "src/domain/res/service.ts"
import type { buildResourceUploads } from "src/domain/res/upload.ts"
import { createAdaptiveConcurrency } from "src/infra/adaptive-concurrency.ts"
import {
	type BenchSuiteModule,
	type CommonArgs,
	intArg,
	intListArg,
	type SuiteArgs,
} from "../args.ts"
import {
	assertRealPluginDists,
	buildZipBuffer,
	createBenchApp,
	createIdPageLoader,
	type DetectTiming,
	fmtMetric,
	fmtMs,
	type HooksFactory,
	hooksFactoryFor,
	type MetricSummary,
	maxPhaseMemory,
	metricFromSummary,
	type PhaseResult,
	randomBytes,
	runPhase,
	runReps,
	type StepTimings,
	summarizeMetric,
	summarizeSamples,
} from "../harness.ts"
import { type BenchMetric, type BenchReport, machineInfo } from "../report.ts"

const PAGE_SIZE = 200
const BYTE_RANGE_SLICE = 64 * 1024

type SuiteIoArgs = {
	readonly common: CommonArgs
	readonly tiers: readonly number[]
	readonly files: number
	readonly bytes: number
	readonly poolNoise: number
}

function resolveArgs(args: SuiteArgs, common: CommonArgs): SuiteIoArgs {
	const tiers = intListArg(args, "tiers")
	const files = intArg(args, "files")
	const bytes = intArg(args, "bytes")
	const poolNoise = intArg(args, "pool-noise")
	if (files < 1) throw new Error("--files must be a positive integer")
	if (bytes < 1024) throw new Error("--bytes must be an integer >= 1024")
	if (poolNoise < 0) {
		throw new Error("--pool-noise must be a non-negative integer")
	}
	return { common, tiers, files, bytes, poolNoise }
}

// ── Corpus generation ────────────────────────────────────────────────────

type CorpusStats = {
	resources: number
	files: number
	bytes: number
	poolNoise: number
	seedMs: number
}

type SeededCorpus = {
	readonly root: string
	readonly res: ReturnType<typeof createResourceService>
	readonly uploads: ReturnType<typeof buildResourceUploads>
	readonly fileBuffer: Buffer
	/** Per-resource staged decoy count (stays in the pool during commit). */
	readonly corpus: CorpusStats
	readonly teardown: () => Promise<void>
}

async function seedCorpus(
	tier: number,
	args: SuiteIoArgs,
	hooksFactory: HooksFactory,
): Promise<SeededCorpus> {
	const root = mkdtempSync(join(tmpdir(), `io-bench-${tier}-`))
	const { res, uploads, teardown } = await createBenchApp(root, hooksFactory)

	const seedStart = performance.now()
	const fileBuffer = randomBytes(args.common.seed + tier, args.bytes)
	const corpus: CorpusStats = {
		resources: tier,
		files: args.files,
		bytes: fileBuffer.length,
		poolNoise: args.poolNoise,
		seedMs: performance.now() - seedStart,
	}

	return {
		root,
		res,
		uploads,
		fileBuffer,
		corpus,
		teardown: async () => {
			await teardown()
		},
	}
}

// ── Upload phases (sequential, per-resource attribution) ─────────────────

type UploadPhaseResult = {
	readonly phase: PhaseResult
	/** Sum of plugin detectFirstMatch wall time across items. */
	readonly detectMs: number
	/** Ids of the resources created by this phase (read-corpus input). */
	readonly ids: readonly string[]
}

async function runUploadPhase(
	seeded: SeededCorpus,
	detectTiming: DetectTiming,
	items: number,
	archiveMode: "none" | "stored" | "deflate",
): Promise<UploadPhaseResult> {
	const { res, uploads, fileBuffer, corpus } = seeded
	const stepMs: StepTimings = {}
	const perItem: number[] = []
	const errors: { id: string; error: string }[] = []
	let succeeded = 0
	let failed = 0
	let peakRss = 0

	async function timed<T>(step: string, fn: () => Promise<T>): Promise<T> {
		const t0 = performance.now()
		try {
			return await fn()
		} finally {
			stepMs[step] = (stepMs[step] ?? 0) + (performance.now() - t0)
		}
	}

	// Decoy files that stay in the pool, so fileId resolution at commit
	// scans a realistic (populated) directory.
	const noiseBuffer = randomBytes(0xdeadbeef, 1024)

	const wallStart = performance.now()
	const ids: string[] = []
	for (let i = 0; i < items; i++) {
		const itemStart = performance.now()
		try {
			const stagedIds: string[] = []
			if (archiveMode === "none") {
				for (let f = 0; f < corpus.files; f++) {
					const staged = await timed("stage", () =>
						uploads.stageSingleFile(
							`img-${String(f).padStart(3, "0")}.jpg`,
							Readable.from(fileBuffer),
						),
					)
					stagedIds.push(staged.fileId)
				}
				for (let n = 0; n < corpus.poolNoise; n++) {
					await uploads.stageSingleFile(
						`noise-${i}-${n}.bin`,
						Readable.from(noiseBuffer),
					)
				}
				detectTiming.reset()
				const created = await timed("create", async () => {
					return res.create({
						files: stagedIds,
						names: stagedIds.map(
							(_, f) => `img-${String(f).padStart(3, "0")}.jpg`,
						),
					})
				})
				ids.push(created.id)
				stepMs.detect = (stepMs.detect ?? 0) + detectTiming.detectMs()
			} else {
				const zip = await buildZipBuffer(
					[["archive.jpg", fileBuffer]],
					archiveMode === "deflate",
				)
				const staged = await timed("stage", () =>
					uploads.stageArchive(Readable.from(zip)),
				)
				detectTiming.reset()
				const created = await timed("create", async () => {
					return res.create({ archiveFileId: staged.fileId })
				})
				ids.push(created.id)
				stepMs.detect = (stepMs.detect ?? 0) + detectTiming.detectMs()
			}
			perItem.push(performance.now() - itemStart)
			succeeded++
		} catch (err) {
			failed++
			errors.push({
				id: `item-${i}`,
				error: err instanceof Error ? err.message : String(err),
			})
		}
		peakRss = Math.max(peakRss, process.memoryUsage().rss)
		if ((i + 1) % 25 === 0) {
			console.log(`    [upload] ${i + 1}/${items} items`)
		}
	}
	const wallMs = performance.now() - wallStart

	return {
		phase: {
			wallMs,
			items: succeeded + failed,
			succeeded,
			failed,
			errors: errors.slice(0, 10),
			stepMs,
			perItemMs: summarizeSamples(perItem),
			itemsPerSec: wallMs > 0 ? (succeeded / wallMs) * 1000 : 0,
			memoryPeakMb: Math.round((peakRss / 1024 / 1024) * 10) / 10,
		},
		detectMs: stepMs.detect ?? 0,
		ids,
	}
}

// ── Rep driver ───────────────────────────────────────────────────────────

type RepResult = {
	readonly upload: UploadPhaseResult
	readonly archiveStored: UploadPhaseResult
	readonly archiveDeflate: UploadPhaseResult
	readonly detail: PhaseResult
	readonly listCards: PhaseResult
	readonly listFilesCold: PhaseResult
	readonly listFilesWarm: PhaseResult
	readonly byteRangeFirst: PhaseResult
	readonly byteRangeWarm: PhaseResult
	readonly fileRequest: PhaseResult
}

async function runRep(
	seeded: SeededCorpus,
	detectTiming: DetectTiming,
): Promise<RepResult> {
	const { root, res, corpus } = seeded
	const concurrency = createAdaptiveConcurrency({
		max: os.cpus().length,
		initial: Math.max(1, os.cpus().length - 1),
	})

	// ── Upload phases ──
	const upload = await runUploadPhase(
		seeded,
		detectTiming,
		corpus.resources,
		"none",
	)
	await res.drainMetaQueue()
	const archiveStored = await runUploadPhase(seeded, detectTiming, 2, "stored")
	const archiveDeflate = await runUploadPhase(
		seeded,
		detectTiming,
		2,
		"deflate",
	)
	await res.drainMetaQueue()
	// Pool noise from the upload phase is bench-local junk — drop it.
	await rm(join(root, "local", ".tmp", "staging"), {
		recursive: true,
		force: true,
	}).catch(() => {})

	// ── Read phases (cold-cache ritual first) ──
	await rm(join(root, "local", "cache", "resources"), {
		recursive: true,
		force: true,
	}).catch(() => {})

	// Read phases iterate the ordered-upload resources of this rep only
	// (archive commits keep their original entry names, so the numbered
	// `1.jpg` entry used below does not exist there).
	const readIds = upload.ids
	const loadReadPage = createIdPageLoader(readIds)

	const detail = await runPhase(
		loadReadPage,
		async (r, timed) => {
			await timed("detail", () => res.detail(r.id))
		},
		concurrency,
		"detail",
	)

	// listCards: page-driven (rows carry pinned tags / characters).
	const cardsSamples: number[] = []
	const cardsWall = performance.now()
	for (let page = 1; ; page++) {
		const t0 = performance.now()
		const list = await res.listCards({ page, size: PAGE_SIZE })
		cardsSamples.push(performance.now() - t0)
		if (list.rows.length === 0 || page > 1000) break
	}
	const cardsWallMs = performance.now() - cardsWall
	const listCards: PhaseResult = {
		wallMs: cardsWallMs,
		items: cardsSamples.length,
		succeeded: cardsSamples.length,
		failed: 0,
		errors: [],
		stepMs: {},
		perItemMs: summarizeSamples(cardsSamples),
		itemsPerSec:
			cardsSamples.length > 0 ? (cardsSamples.length / cardsWallMs) * 1000 : 0,
		memoryPeakMb: 0,
	}

	const listFilesCold = await runPhase(
		loadReadPage,
		async (r, timed) => {
			await timed("listFiles", () => res.listFiles(r.id))
		},
		concurrency,
		"listFiles.cold",
	)

	const listFilesWarm = await runPhase(
		loadReadPage,
		async (r, timed) => {
			await timed("listFiles", () => res.listFiles(r.id))
		},
		concurrency,
		"listFiles.warm",
	)

	// First entry name: the ordered-upload corpus stages `img-000.jpg`-style
	// names, so the first entry keeps its original filename.
	const firstEntry = "img-000.jpg"

	const byteRangeFirst = await runPhase(
		loadReadPage,
		async (r, timed) => {
			const view = await timed("resolveView", () => res.resolveSourceView(r.id))
			const range = await timed("resolveRange", () =>
				view.resolveByteRange(firstEntry),
			)
			if (range === undefined) {
				throw new Error(`no byte range for ${firstEntry} in ${r.id}`)
			}
			await timed("slice", () =>
				view.readEntrySlice(firstEntry, 0, BYTE_RANGE_SLICE),
			)
		},
		concurrency,
		"byteRange.first",
	)

	const byteRangeWarm = await runPhase(
		loadReadPage,
		async (r, timed) => {
			const view = await timed("resolveView", () => res.resolveSourceView(r.id))
			const range = await timed("resolveRange", () =>
				view.resolveByteRange(firstEntry),
			)
			if (range === undefined) {
				throw new Error(`no byte range for ${firstEntry} in ${r.id}`)
			}
			await timed("slice", () =>
				view.readEntrySlice(firstEntry, 0, BYTE_RANGE_SLICE),
			)
		},
		concurrency,
		"byteRange.warm",
	)

	// Full GET /files/* simulation: detail + view + range + stream drain.
	const fileRequest = await runPhase(
		loadReadPage,
		async (r, timed) => {
			await timed("detail", () => res.detail(r.id))
			const view = await timed("resolveView", () => res.resolveSourceView(r.id))
			const range = await timed("resolveRange", () =>
				view.resolveByteRange(firstEntry),
			)
			if (range === undefined) {
				throw new Error(`no byte range for ${firstEntry} in ${r.id}`)
			}
			let got = 0
			await timed("stream", async () => {
				const { stream } = await view.openEntryStream(firstEntry)
				for await (const chunk of stream) {
					got += chunk.length
				}
			})
			if (got !== range.size) {
				throw new Error(
					`stream mismatch for ${firstEntry}: expected ${range.size}, got ${got}`,
				)
			}
		},
		concurrency,
		"fileRequest",
	)

	await res.drainMetaQueue()

	return {
		upload,
		archiveStored,
		archiveDeflate,
		detail,
		listCards,
		listFilesCold,
		listFilesWarm,
		byteRangeFirst,
		byteRangeWarm,
		fileRequest,
	}
}

// ── Tier driver + reporting ──────────────────────────────────────────────

type TierResult = {
	readonly tier: number
	readonly corpus: CorpusStats
	readonly reps: readonly RepResult[]
	readonly summary: TierSummary
}

type PhaseMetricSummary = {
	readonly wallMs: MetricSummary
	readonly itemsPerSec: MetricSummary
	readonly perItemMeanMs: MetricSummary
}

type TierSummary = {
	readonly upload: PhaseMetricSummary
	readonly archiveStored: PhaseMetricSummary
	readonly archiveDeflate: PhaseMetricSummary
	readonly detail: PhaseMetricSummary
	readonly listCards: PhaseMetricSummary
	readonly listFilesCold: PhaseMetricSummary
	readonly listFilesWarm: PhaseMetricSummary
	readonly byteRangeFirst: PhaseMetricSummary
	readonly byteRangeWarm: PhaseMetricSummary
	readonly fileRequest: PhaseMetricSummary
	readonly uploadDetectMs: MetricSummary
}

function phaseSummary(
	reps: readonly RepResult[],
	pick: (r: RepResult) => PhaseResult,
): PhaseMetricSummary {
	return {
		wallMs: summarizeMetric(reps.map((r) => pick(r).wallMs)),
		itemsPerSec: summarizeMetric(reps.map((r) => pick(r).itemsPerSec)),
		perItemMeanMs: summarizeMetric(reps.map((r) => pick(r).perItemMs.mean)),
	}
}

async function benchTier(tier: number, args: SuiteIoArgs): Promise<TierResult> {
	console.log(`\n=== tier ${tier} — seeding ===`)
	const wiring = hooksFactoryFor(args.common, { wrap: "detect" })
	const seeded = await seedCorpus(tier, args, wiring.factory)
	console.log(
		`    corpus: ${seeded.corpus.resources} resources x ${seeded.corpus.files} files x ${seeded.corpus.bytes} B (pool noise ${seeded.corpus.poolNoise}), seeded in ${(seeded.corpus.seedMs / 1000).toFixed(1)}s`,
	)

	const detectTiming = wiring.detectTiming()
	if (detectTiming === undefined) {
		throw new Error("detect timing wiring missing — wrap must be detect")
	}
	const reps = await runReps(seeded, `tier ${tier}`, args.common.repeat, () =>
		runRep(seeded, detectTiming),
	)

	return {
		tier,
		corpus: seeded.corpus,
		reps,
		summary: {
			upload: phaseSummary(reps, (r) => r.upload.phase),
			archiveStored: phaseSummary(reps, (r) => r.archiveStored.phase),
			archiveDeflate: phaseSummary(reps, (r) => r.archiveDeflate.phase),
			detail: phaseSummary(reps, (r) => r.detail),
			listCards: phaseSummary(reps, (r) => r.listCards),
			listFilesCold: phaseSummary(reps, (r) => r.listFilesCold),
			listFilesWarm: phaseSummary(reps, (r) => r.listFilesWarm),
			byteRangeFirst: phaseSummary(reps, (r) => r.byteRangeFirst),
			byteRangeWarm: phaseSummary(reps, (r) => r.byteRangeWarm),
			fileRequest: phaseSummary(reps, (r) => r.fileRequest),
			uploadDetectMs: summarizeMetric(reps.map((r) => r.upload.detectMs)),
		},
	}
}

function printTier(result: TierResult): void {
	const { reps } = result
	const medianRep = reps[Math.floor(reps.length / 2)] ?? reps[0]
	const summary = result.summary
	console.log(
		`  upload: wall ${fmtMetric(summary.upload.wallMs, "ms")} | ${fmtMetric(summary.upload.itemsPerSec, "/s")} | item mean ${fmtMetric(summary.upload.perItemMeanMs, "ms")}`,
	)
	if (medianRep !== undefined) {
		console.log(
			`    steps: stage ${fmtMs(medianRep.upload.phase.stepMs.stage ?? 0)} | create ${fmtMs(medianRep.upload.phase.stepMs.create ?? 0)} | detect (inside create) ${fmtMs(medianRep.upload.detectMs)}`,
		)
	}
	console.log(
		`  archive: stored wall ${fmtMetric(summary.archiveStored.wallMs, "ms")} | deflate wall ${fmtMetric(summary.archiveDeflate.wallMs, "ms")}`,
	)
	if (medianRep !== undefined) {
		console.log(
			`    stored steps: stage ${fmtMs(medianRep.archiveStored.phase.stepMs.stage ?? 0)} | create ${fmtMs(medianRep.archiveStored.phase.stepMs.create ?? 0)}`,
		)
		console.log(
			`    deflate steps: stage ${fmtMs(medianRep.archiveDeflate.phase.stepMs.stage ?? 0)} | create ${fmtMs(medianRep.archiveDeflate.phase.stepMs.create ?? 0)}`,
		)
	}
	for (const [label, key] of [
		["detail", "detail"],
		["listCards", "listCards"],
		["listFiles.cold", "listFilesCold"],
		["listFiles.warm", "listFilesWarm"],
		["byteRange.first", "byteRangeFirst"],
		["byteRange.warm", "byteRangeWarm"],
		["fileRequest", "fileRequest"],
	] as const) {
		const s = summary[key]
		console.log(
			`  ${label}: wall ${fmtMetric(s.wallMs, "ms")} | item mean ${fmtMetric(s.perItemMeanMs, "ms")}`,
		)
	}
	if (medianRep !== undefined) {
		console.log(
			`    fileRequest steps: detail ${fmtMs(medianRep.fileRequest.stepMs.detail ?? 0)} | resolveView ${fmtMs(medianRep.fileRequest.stepMs.resolveView ?? 0)} | resolveRange ${fmtMs(medianRep.fileRequest.stepMs.resolveRange ?? 0)} | stream ${fmtMs(medianRep.fileRequest.stepMs.stream ?? 0)}`,
		)
	}
	const failed = reps.reduce(
		(acc, r) =>
			acc +
			r.upload.phase.failed +
			r.archiveStored.phase.failed +
			r.archiveDeflate.phase.failed +
			r.detail.failed +
			r.listFilesCold.failed +
			r.listFilesWarm.failed +
			r.byteRangeFirst.failed +
			r.byteRangeWarm.failed +
			r.fileRequest.failed,
		0,
	)
	if (failed > 0) console.log(`  FAILURES across reps: ${failed}`)
}

// Regression metrics: per-item means + throughput of the largest tier.
export function extractIoMetrics(report: BenchReport): BenchMetric[] {
	const tiers = (report.tiers ?? []) as readonly TierResult[]
	const last = tiers[tiers.length - 1]
	if (last === undefined) return []
	const s = last.summary
	return [
		metricFromSummary("upload.wallMs", "ms", s.upload.wallMs),
		metricFromSummary("upload.perItemMeanMs", "ms", s.upload.perItemMeanMs),
		metricFromSummary("upload.itemsPerSec", "/s", s.upload.itemsPerSec),
		metricFromSummary("archiveStored.wallMs", "ms", s.archiveStored.wallMs),
		metricFromSummary("archiveDeflate.wallMs", "ms", s.archiveDeflate.wallMs),
		metricFromSummary("detail.perItemMeanMs", "ms", s.detail.perItemMeanMs),
		metricFromSummary(
			"listCards.perItemMeanMs",
			"ms",
			s.listCards.perItemMeanMs,
		),
		metricFromSummary(
			"listFilesCold.perItemMeanMs",
			"ms",
			s.listFilesCold.perItemMeanMs,
		),
		metricFromSummary(
			"listFilesWarm.perItemMeanMs",
			"ms",
			s.listFilesWarm.perItemMeanMs,
		),
		metricFromSummary(
			"byteRangeFirst.perItemMeanMs",
			"ms",
			s.byteRangeFirst.perItemMeanMs,
		),
		metricFromSummary(
			"byteRangeWarm.perItemMeanMs",
			"ms",
			s.byteRangeWarm.perItemMeanMs,
		),
		metricFromSummary(
			"fileRequest.perItemMeanMs",
			"ms",
			s.fileRequest.perItemMeanMs,
		),
	]
}

function maxTierPhaseMemory(tiers: readonly TierResult[]): number {
	const phases = tiers.flatMap((t) =>
		t.reps.flatMap((r) => [
			r.upload.phase,
			r.archiveStored.phase,
			r.archiveDeflate.phase,
			r.detail,
			r.listCards,
			r.listFilesCold,
			r.listFilesWarm,
			r.byteRangeFirst,
			r.byteRangeWarm,
			r.fileRequest,
		]),
	)
	return maxPhaseMemory(phases)
}

export const ioSuite: BenchSuiteModule = {
	name: "io",
	title: "io bench",
	flagSpecs: [
		{
			name: "tiers",
			kind: "intList",
			description: "resource counts per tier",
			default: [100, 400],
		},
		{
			name: "files",
			kind: "int",
			description: "files per resource",
			default: 10,
		},
		{
			name: "bytes",
			kind: "int",
			description: "bytes per file",
			default: 256 * 1024,
		},
		{
			name: "pool-noise",
			kind: "int",
			description: "staged decoy files per resource (staging-pool scan cost)",
			default: 0,
		},
	],
	checkDefaults: { tiers: "100", repeat: "2" },
	run: async (args, common) => {
		const sArgs = resolveArgs(args, common)
		assertRealPluginDists(common)
		console.log(
			`tiers: ${sArgs.tiers.join(", ")} | files: ${sArgs.files} | bytes: ${sArgs.bytes} | pool-noise: ${sArgs.poolNoise} | plugins: ${common.plugins}${common.plugin !== undefined ? ` + ${common.plugin}` : ""} | repeat: ${common.repeat} | out: ${common.out} | seed: ${common.seed}`,
		)

		const tiers: TierResult[] = []
		for (const tier of sArgs.tiers) {
			const result = await benchTier(tier, sArgs)
			tiers.push(result)
			console.log(
				`\n--- tier ${tier} summary (median [min–max] of ${common.repeat}) ---`,
			)
			printTier(result)
		}

		const report: BenchReport = {
			schema: 1,
			kind: "io",
			timestamp: new Date().toISOString(),
			config: {
				files: sArgs.files,
				bytes: sArgs.bytes,
				poolNoise: sArgs.poolNoise,
				plugins: common.plugins,
				plugin: undefined,
				repeat: common.repeat,
				seed: common.seed,
			},
			machine: machineInfo(),
			caveats: [
				"Only same-window paired runs are comparable — the machine shows bimodal load (up to 4x swings).",
				"Upload phases run sequentially; read phases use adaptive concurrency (max cpus, initial cpus-1) like production.",
				"Step/hook aggregates are wall-time sums across concurrent items; they exceed phase wall time in proportion to parallelism.",
				"The corpus is pseudo-random (incompressible) bytes; the stub is the in-process file-contract plugin (real CD parse + zip IO, no probing), real mode adds the sandbox RPC of the builtin file plugin (detect + statFiles round-trips per listFiles). Meta queues are drained between phases; upload cover render is out of scope (precache bench covers it).",
				"listFiles.cold / byteRange.first start from a wiped local/cache + cleared zip CD cache (cold restart); warm phases reuse them.",
				"detect step is the plugin detectFirstMatch wall time captured inside resource.create — the only finalize step not visible from outside.",
			],
			memoryPeakMb: maxTierPhaseMemory(tiers),
			tiers,
		}
		return { common, report, extractMetrics: extractIoMetrics }
	},
}
