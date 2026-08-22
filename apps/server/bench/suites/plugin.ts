/**
 * Plugin-sandbox RPC benchmark: measures the per-hook and per-ResourceAPI
 * call cost of the worker-thread sandbox with the builtin file plugin.
 *
 * Phases:
 *   upload        — stageArchive + resource.create per resource
 *                   (sequential): the plugin detectFirstMatch RPC happens
 *                   inside create (timed via withDetectTiming).
 *   meta          — res.rebuildAllMeta per resource: runMetaHooks
 *                   (sourceMeta) RPC.
 *   listFiles.cold— res.listFiles with wiped files-cache + zip CD cache:
 *                   buildFileList hook = one statFiles RPC per chunk of
 *                   PLUGIN_STAT_CONCURRENCY entries + CD parse + sidecar write.
 *   listFiles.warm— files-cache wiped again, zip CD cache warm: the same
 *                   statFiles RPCs without the CD parse.
 *
 * Stub vs real (`--plugins=`):
 *   real (default) — production wiring: sandbox worker + loader + the real
 *     builtin file plugin (must be built; errors with a hint otherwise).
 *     `--plugin=<dist-dir>` adds a dev plugin (its detector matches first).
 *   stub — in-process file-contract stub from harness.ts: same operations,
 *     no worker RPC. Run it back-to-back with real to isolate RPC cost.
 *
 * Worker load timing (report-only): loader.loadAll step durations
 * ("dispose", "seed", "discover", "activate") via the loader's onTiming.
 *
 * Lifecycle churn (`--churn=N`, real mode only, NOT part of --check):
 * races N loader rescans against concurrent meta rebuilds — the
 * worker-lifecycle storm shape that previously stranded a stale registry
 * ("worker stopped"/"sandbox disposed" floods). Reports churn.wallMs and
 * churn.errorLines (console lines tagged [plugin-*]); a healthy sandbox
 * emits zero error lines because loadPlugin only retires workers after a
 * successful reload. churn.errorLines has a 0 baseline, so any failure
 * trips the regression gate when --churn is given explicitly.
 *
 * Usage:
 *   pnpm -F @hoardodile/server bench plugin
 *   pnpm -F @hoardodile/server bench plugin --tiers=50 --files=200
 *   pnpm -F @hoardodile/server bench plugin --plugins=stub
 *   pnpm -F @hoardodile/server bench plugin --churn=5
 *   pnpm -F @hoardodile/server bench plugin --check (regression gate vs bench/baselines/plugin.json)
 *
 * Results are written as JSON to <repo>/tmp/bench/<out>; `--save` also
 * writes the suite baseline. Shared infra lives in harness.ts.
 */
import { mkdtempSync } from "node:fs"
import { rm } from "node:fs/promises"
import { tmpdir } from "node:os"
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

const FILE_BYTES = 8 * 1024

type SuitePluginArgs = {
	readonly common: CommonArgs
	readonly tiers: readonly number[]
	readonly files: number
	readonly churn: number
}

function resolveArgs(args: SuiteArgs, common: CommonArgs): SuitePluginArgs {
	const tiers = intListArg(args, "tiers")
	const files = intArg(args, "files")
	if (files < 1) throw new Error("--files must be a positive integer")
	const churn = intArg(args, "churn")
	return { common, tiers, files, churn }
}

type CorpusStats = {
	resources: number
	files: number
	bytes: number
	seedMs: number
}

type SeededCorpus = {
	readonly root: string
	readonly res: ReturnType<typeof createResourceService>
	readonly uploads: ReturnType<typeof buildResourceUploads>
	readonly zips: readonly Buffer[]
	readonly corpus: CorpusStats
	/** Reload the plugin registry (real mode only). */
	readonly rescan?: () => Promise<void>
	readonly teardown: () => Promise<void>
}

async function seedCorpus(
	tier: number,
	args: SuitePluginArgs,
	hooksFactory: HooksFactory,
): Promise<SeededCorpus> {
	const root = mkdtempSync(join(tmpdir(), `plugin-bench-${tier}-`))
	const { res, uploads, rescan, teardown } = await createBenchApp(
		root,
		hooksFactory,
	)

	// Stored archives with `args.files` pseudo-random entries each — the
	// file plugin's listFiles stats every entry, so the CD size and the
	// statFile fan-out scale with the file count. Zips are built once at
	// seed time; uploads happen fresh in every rep.
	const seedStart = performance.now()
	const byte = randomBytes(args.common.seed + tier, FILE_BYTES)
	const zips: Buffer[] = []
	for (let i = 0; i < tier; i++) {
		const entries = Array.from(
			{ length: args.files },
			(_, k) => [`img-${String(k).padStart(4, "0")}.jpg`, byte] as const,
		)
		zips.push(await buildZipBuffer(entries, false))
	}
	const corpus: CorpusStats = {
		resources: tier,
		files: args.files,
		bytes: byte.length * args.files,
		seedMs: performance.now() - seedStart,
	}

	return {
		root,
		res,
		uploads,
		zips,
		corpus,
		rescan,
		teardown: async () => {
			await teardown()
		},
	}
}

// ── Rep driver ───────────────────────────────────────────────────────────

type RepResult = {
	readonly upload: PhaseResult
	readonly meta: PhaseResult
	readonly listFilesCold: PhaseResult
	readonly listFilesWarm: PhaseResult
	/** Sum of plugin detectFirstMatch wall time across upload items. */
	readonly uploadDetectMs: number
	/** Present when `--churn=N` was given in real mode. */
	readonly churn?: {
		readonly wallMs: number
		/** Console lines tagged `[plugin-*]` — hook/sandbox failures. */
		readonly errorLines: number
		/** True when the churn storm left no error lines behind. */
		readonly healthOk: boolean
	}
}

async function runRep(
	seeded: SeededCorpus,
	detectTiming: DetectTiming,
	churnRounds: number,
): Promise<RepResult> {
	const { root, res, uploads, zips, corpus } = seeded
	const sequential = createAdaptiveConcurrency({ max: 1, initial: 1 })
	const readIds: string[] = []
	const loadReadPage = createIdPageLoader(readIds)

	// ── Upload phase: stage + create per resource (sequential), detect RPC
	// captured inside create — same pattern as the io suite.
	const stepMs: StepTimings = {}
	const perItem: number[] = []
	const errors: { id: string; error: string }[] = []
	let succeeded = 0
	let failed = 0
	let peakRss = 0
	const wallStart = performance.now()
	for (let i = 0; i < corpus.resources; i++) {
		const itemStart = performance.now()
		try {
			const t0 = performance.now()
			const staged = await uploads.stageArchive(Readable.from(zips[i]!))
			stepMs.stage = (stepMs.stage ?? 0) + (performance.now() - t0)
			detectTiming.reset()
			const t1 = performance.now()
			const created = await res.create({ archiveFileId: staged.fileId })
			stepMs.create = (stepMs.create ?? 0) + (performance.now() - t1)
			stepMs.detect = (stepMs.detect ?? 0) + detectTiming.detectMs()
			readIds.push(created.id)
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
		if ((i + 1) % 10 === 0) {
			console.log(`    [upload] ${i + 1}/${corpus.resources} items`)
		}
	}
	const wallMs = performance.now() - wallStart
	const upload: PhaseResult = {
		wallMs,
		items: succeeded + failed,
		succeeded,
		failed,
		errors: errors.slice(0, 10),
		stepMs,
		perItemMs: summarizeSamples(perItem),
		itemsPerSec: wallMs > 0 ? (succeeded / wallMs) * 1000 : 0,
		memoryPeakMb: Math.round((peakRss / 1024 / 1024) * 10) / 10,
	}
	await res.drainMetaQueue()

	// ── Meta phase: rebuildAllMeta (sourceMeta RPC per resource) ──
	const meta = await runPhase(
		loadReadPage,
		async (r, timed) => {
			await timed("rebuildAllMeta", () => res.rebuildAllMeta(r.id))
		},
		sequential,
		"meta",
	)
	await res.drainMetaQueue()

	// ── Lifecycle churn (real mode, --churn=N): race loader rescans
	// against live meta rebuilds. Every hook failure is swallowed by the
	// facade by design and surfaces as a [plugin-hooks]/[plugin-sandbox]
	// console line — so the phase counts those lines as the failure
	// signal. A healthy sandbox emits zero (loadPlugin retires workers
	// only after a successful reload).
	let churn: RepResult["churn"]
	if (churnRounds > 0 && seeded.rescan !== undefined) {
		const ids = readIds.slice(0, Math.min(readIds.length, 12))
		const originalError = console.error
		const originalWarn = console.warn
		let errorLines = 0
		console.error = (...args: unknown[]) => {
			if (String(args[0]).includes("[plugin-")) errorLines++
			originalError(...args)
		}
		console.warn = (...args: unknown[]) => {
			if (String(args[0]).includes("[plugin-")) errorLines++
			originalWarn(...args)
		}
		const wallStart = performance.now()
		try {
			for (let i = 0; i < churnRounds; i++) {
				// 4 concurrent rebuilds racing one registry reload — the
				// storm shape from the "sandbox disposed" regression.
				const jobs = ids.slice(0, 4).map(async (id) => res.rebuildAllMeta(id))
				await Promise.all([seeded.rescan(), ...jobs])
			}
		} finally {
			console.error = originalError
			console.warn = originalWarn
		}
		churn = {
			wallMs: performance.now() - wallStart,
			errorLines,
			healthOk: errorLines === 0,
		}
	}

	// ── listFiles: cold (files-cache wiped) vs warm (sidecar kept) ──
	await rm(join(root, "local", "cache", "resources"), {
		recursive: true,
		force: true,
	}).catch(() => {})
	const listFilesCold = await runPhase(
		loadReadPage,
		async (r, timed) => {
			await timed("listFiles", () => res.listFiles(r.id))
		},
		sequential,
		"listFiles.cold",
	)

	// Drop the sidecar cache again — the warm phase measures the N
	// statFile RPCs without the container listing.
	await rm(join(root, "local", "cache", "resources"), {
		recursive: true,
		force: true,
	}).catch(() => {})
	const listFilesWarm = await runPhase(
		loadReadPage,
		async (r, timed) => {
			await timed("listFiles", () => res.listFiles(r.id))
		},
		sequential,
		"listFiles.warm",
	)

	return {
		upload,
		meta,
		listFilesCold,
		listFilesWarm,
		uploadDetectMs: stepMs.detect ?? 0,
		churn,
	}
}

// ── Tier driver + reporting ──────────────────────────────────────────────

type TierResult = {
	readonly tier: number
	readonly corpus: CorpusStats
	readonly reps: readonly RepResult[]
	readonly summary: {
		readonly upload: {
			readonly wallMs: MetricSummary
			readonly perItemMeanMs: MetricSummary
		}
		readonly meta: {
			readonly wallMs: MetricSummary
			readonly perItemMeanMs: MetricSummary
		}
		readonly listFilesCold: {
			readonly wallMs: MetricSummary
			readonly perItemMeanMs: MetricSummary
		}
		readonly listFilesWarm: {
			readonly wallMs: MetricSummary
			readonly perItemMeanMs: MetricSummary
		}
		readonly churn?: {
			readonly wallMs: MetricSummary
			readonly errorLines: MetricSummary
		}
	}
}

async function benchTier(
	tier: number,
	args: SuitePluginArgs,
	onTiming?: (step: string, ms: number) => void,
): Promise<TierResult> {
	console.log(`\n=== tier ${tier} — seeding ===`)
	const wiring = hooksFactoryFor(args.common, { wrap: "detect", onTiming })
	const seeded = await seedCorpus(tier, args, wiring.factory)
	console.log(
		`    corpus: ${seeded.corpus.resources} resources x ${seeded.corpus.files} files x ${seeded.corpus.bytes} B, seeded in ${(seeded.corpus.seedMs / 1000).toFixed(1)}s`,
	)

	const detectTiming = wiring.detectTiming()
	if (detectTiming === undefined) {
		throw new Error("detect timing wiring missing — wrap must be detect")
	}
	const reps = await runReps(seeded, `tier ${tier}`, args.common.repeat, () =>
		runRep(seeded, detectTiming, args.churn),
	)

	const phaseSummary = (pick: (r: RepResult) => PhaseResult) => ({
		wallMs: summarizeMetric(reps.map((r) => pick(r).wallMs)),
		perItemMeanMs: summarizeMetric(reps.map((r) => pick(r).perItemMs.mean)),
	})
	const churnRuns = reps.filter((r) => r.churn !== undefined)
	return {
		tier,
		corpus: seeded.corpus,
		reps,
		summary: {
			upload: phaseSummary((r) => r.upload),
			meta: phaseSummary((r) => r.meta),
			listFilesCold: phaseSummary((r) => r.listFilesCold),
			listFilesWarm: phaseSummary((r) => r.listFilesWarm),
			churn:
				churnRuns.length > 0
					? {
							wallMs: summarizeMetric(
								churnRuns.map((r) => r.churn?.wallMs ?? 0),
							),
							errorLines: summarizeMetric(
								churnRuns.map((r) => r.churn?.errorLines ?? 0),
							),
						}
					: undefined,
		},
	}
}

function printTier(result: TierResult): void {
	const { reps } = result
	const medianRep = reps[Math.floor(reps.length / 2)] ?? reps[0]
	const s = result.summary
	console.log(
		`  upload: wall ${fmtMetric(s.upload.wallMs, "ms")} | item mean ${fmtMetric(s.upload.perItemMeanMs, "ms")}`,
	)
	if (medianRep !== undefined) {
		console.log(
			`    steps: stage ${fmtMs(medianRep.upload.stepMs.stage ?? 0)} | create ${fmtMs(medianRep.upload.stepMs.create ?? 0)} | detect (inside create) ${fmtMs(medianRep.uploadDetectMs)}`,
		)
	}
	console.log(
		`  meta: wall ${fmtMetric(s.meta.wallMs, "ms")} | item mean ${fmtMetric(s.meta.perItemMeanMs, "ms")}`,
	)
	console.log(
		`  listFiles.cold: wall ${fmtMetric(s.listFilesCold.wallMs, "ms")} | item mean ${fmtMetric(s.listFilesCold.perItemMeanMs, "ms")}`,
	)
	console.log(
		`  listFiles.warm: wall ${fmtMetric(s.listFilesWarm.wallMs, "ms")} | item mean ${fmtMetric(s.listFilesWarm.perItemMeanMs, "ms")}`,
	)
	if (s.churn !== undefined) {
		console.log(
			`  churn: wall ${fmtMetric(s.churn.wallMs, "ms")} | error lines ${fmtMetric(s.churn.errorLines, "ms")}${medianRep?.churn?.healthOk === false ? " | HEALTH CHECK FAILED" : ""}`,
		)
	}
	const failed = reps.reduce(
		(acc, r) =>
			acc +
			r.upload.failed +
			r.meta.failed +
			r.listFilesCold.failed +
			r.listFilesWarm.failed,
		0,
	)
	if (failed > 0) console.log(`  FAILURES across reps: ${failed}`)
}

// Regression metrics: per-item means of the largest tier.
export function extractPluginMetrics(report: BenchReport): BenchMetric[] {
	const tiers = (report.tiers ?? []) as readonly TierResult[]
	const last = tiers[tiers.length - 1]
	if (last === undefined) return []
	const s = last.summary
	return [
		metricFromSummary("upload.perItemMeanMs", "ms", s.upload.perItemMeanMs),
		metricFromSummary("meta.perItemMeanMs", "ms", s.meta.perItemMeanMs),
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
	]
}

/**
 * Churn metrics — only present when `--churn=N` ran. `--check` never
 * passes --churn, so the fresh report has no churn metrics and the
 * baseline's are skipped as "missing"; an explicit `--check --churn=N`
 * compares them. churn.errorLines has a 0 baseline, so any
 * worker-lifecycle failure trips the gate.
 */
export function extractChurnMetrics(report: BenchReport): BenchMetric[] {
	const tiers = (report.tiers ?? []) as readonly TierResult[]
	const last = tiers[tiers.length - 1]
	if (last?.summary.churn === undefined) return []
	return [
		metricFromSummary("churn.wallMs", "ms", last.summary.churn.wallMs),
		metricFromSummary(
			"churn.errorLines",
			"count",
			last.summary.churn.errorLines,
		),
	]
}

function maxTierPhaseMemory(tiers: readonly TierResult[]): number {
	const phases = tiers.flatMap((t) =>
		t.reps.flatMap((r) => [r.upload, r.meta, r.listFilesCold, r.listFilesWarm]),
	)
	return maxPhaseMemory(phases)
}

export const pluginSuite: BenchSuiteModule = {
	name: "plugin",
	title: "plugin bench",
	defaultPlugins: "real",
	flagSpecs: [
		{
			name: "tiers",
			kind: "intList",
			description: "resource counts per tier",
			default: [20],
		},
		{
			name: "files",
			kind: "int",
			description: "archive entries per resource",
			default: 100,
		},
		{
			name: "churn",
			kind: "int",
			description:
				"real-mode lifecycle stress: N loader rescans raced against live meta rebuilds (report-only; not part of --check)",
			default: 0,
		},
	],
	checkDefaults: { tiers: "10", repeat: "3" },
	run: async (rawArgs, common) => {
		const args = resolveArgs(rawArgs, common)
		assertRealPluginDists(common)
		const machine = machineInfo()
		console.log(
			`tiers: ${args.tiers.join(", ")} | files: ${args.files} | churn: ${args.churn} | plugins: ${common.plugins}${common.plugin !== undefined ? ` + ${common.plugin}` : ""} | repeat: ${common.repeat} | out: ${common.out} | seed: ${common.seed}`,
		)

		// Worker load timing (report-only): the loader runs once per tier in
		// real mode; the first tier's timings represent a cold boot (fresh
		// sandbox spawn + main.js import in the worker).
		const workerLoadMs: Record<string, number> = {}
		const tiers: TierResult[] = []
		for (const [index, tier] of args.tiers.entries()) {
			const onTiming = (step: string, ms: number) => {
				if (index === 0) workerLoadMs[step] = (workerLoadMs[step] ?? 0) + ms
			}
			const result = await benchTier(tier, args, onTiming)
			tiers.push(result)
			console.log(
				`\n--- tier ${tier} summary (median [min–max] of ${common.repeat}) ---`,
			)
			printTier(result)
		}
		if (common.plugins === "real" && args.tiers.length > 0) {
			console.log(`worker load (tier ${args.tiers[0]}, real mode):`)
			for (const [step, ms] of Object.entries(workerLoadMs)) {
				console.log(`  ${step}: ${fmtMs(ms)}`)
			}
		}

		const report: BenchReport = {
			schema: 1,
			kind: "plugin",
			timestamp: new Date().toISOString(),
			config: {
				files: args.files,
				plugins: common.plugins,
				plugin: common.plugin,
				churn: args.churn,
				repeat: common.repeat,
				seed: common.seed,
				workerLoadMs: common.plugins === "real" ? workerLoadMs : undefined,
			},
			machine,
			caveats: [
				"Only same-window paired runs are comparable — the machine shows bimodal load (up to 4x swings).",
				"Phases run sequentially (concurrency 1) so per-item means isolate RPC cost; production serves listFiles via the files-cache sidecar, so listFiles.warm with the sidecar wiped measures the RPC path, not the steady-state cache read.",
				"Each listFiles hook call = 1 worker round-trip; the file plugin's listFiles calls statFiles once per PLUGIN_STAT_CONCURRENCY=8 chunk (13 round-trips for 100 files instead of 100). Step/hook sums exceed phase wall time under that fan-out.",
				"Real mode seeds against the builtin file plugin (detect matches first); a --plugin dev plugin's detector wins when present.",
				"Each tier is seeded once; uploads happen fresh in every rep; reps share host-side caches (zip CD cache, probe cache) — rep 1 is the cold rep.",
				"churn (real mode only): N loader rescans raced against concurrent meta rebuilds; churn.errorLines counts console lines tagged [plugin-*] (every hook failure is swallowed by the facade and logged) — 0 on a healthy sandbox, so any lifecycle regression trips the gate when --churn is compared explicitly.",
			],
			memoryPeakMb: maxTierPhaseMemory(tiers),
			tiers,
		}
		return {
			common,
			report,
			extractMetrics: (r) => [
				...extractPluginMetrics(r),
				...extractChurnMetrics(r),
			],
		}
	},
}
