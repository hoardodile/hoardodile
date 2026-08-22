/**
 * Report + baseline contract for the bench suites: the JSON schema written
 * to `tmp/bench/` (and copied as the regression baseline in
 * `bench/baselines/<suite>.json`), the metric comparison
 * (`checkBaseline`) and persistence (`loadBaseline`/`finishBench`).
 *
 * Comparison rule (bimodal machine load): only same-window paired runs are
 * comparable; baselines are only valid on the same machine and environment —
 * a machine mismatch is reported but does not abort the comparison.
 *
 * Deliberately dependency-free (node builtins only) so unit tests can
 * exercise the report contract without pulling in the plugin/host stack.
 */
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { mkdir, writeFile } from "node:fs/promises"
import os from "node:os"
import { dirname, join, resolve } from "node:path"
import { fileURLToPath } from "node:url"
import type { CommonArgs } from "./args.ts"

const BENCH_DIR = dirname(fileURLToPath(import.meta.url))
export const OUT_DIR = join(resolve(BENCH_DIR, "../../.."), "tmp", "bench")
export const BASELINES_DIR = join(BENCH_DIR, "baselines")

// ── Machine fingerprint ───────────────────────────────────────────────────

export type MachineInfo = {
	readonly platform: string
	readonly arch: string
	readonly cpus: number
	readonly cpuModel: string
	readonly node: string
}

export function machineInfo(): MachineInfo {
	return {
		platform: os.platform(),
		arch: os.arch(),
		cpus: os.cpus().length,
		cpuModel: os.cpus()[0]?.model ?? "unknown",
		node: process.version,
	}
}

function fingerprint(machine: MachineInfo): string {
	return [
		machine.platform,
		machine.arch,
		machine.cpus,
		machine.cpuModel,
		machine.node,
	].join("|")
}

function sameMachine(a: MachineInfo, b: MachineInfo): boolean {
	return fingerprint(a) === fingerprint(b)
}

// ── Report contract ───────────────────────────────────────────────────────

export type BenchMetric = {
	readonly name: string
	readonly unit: "ms" | "/s" | "MB" | "rate" | "count"
	readonly median: number
	readonly min: number
	readonly max: number
}

export type BenchReport = {
	readonly schema: 1
	readonly kind: string
	readonly timestamp: string
	readonly config: unknown
	readonly machine: MachineInfo
	readonly caveats: readonly string[]
	readonly memoryPeakMb: number
	readonly [key: string]: unknown
}

/** Extract the per-task metrics the tinybench suites store on the report. */
export function extractStoredMetrics(
	report: BenchReport,
): readonly BenchMetric[] {
	return (report.metrics as readonly BenchMetric[] | undefined) ?? []
}

export function isBenchReport(value: unknown): value is BenchReport {
	if (typeof value !== "object" || value === null) return false
	const v = value as Record<string, unknown>
	return (
		v.schema === 1 &&
		typeof v.kind === "string" &&
		typeof v.timestamp === "string" &&
		typeof v.machine === "object" &&
		v.machine !== null &&
		typeof v.memoryPeakMb === "number"
	)
}

// ── Baseline comparison ───────────────────────────────────────────────────

export type CheckOptions = {
	readonly suite: string
	readonly thresholdPercent: number
	readonly report: BenchReport
	readonly baseline: BenchReport
	readonly extractMetrics: (report: BenchReport) => readonly BenchMetric[]
}

export type CheckResult = {
	readonly regressed: boolean
	/** True when the fresh report was produced on a different machine than the baseline. */
	readonly machineMismatch: boolean
	readonly message: string
}

/**
 * Compare a fresh report against a baseline via the suite's metric
 * extraction. Fails when a fresh median exceeds its baseline by more than
 * `thresholdPercent`; reports (does not fail on) machine mismatches — the
 * caller decides how to surface them.
 */
export function checkBaseline(opts: CheckOptions): CheckResult {
	const machineMismatch = !sameMachine(
		opts.report.machine,
		opts.baseline.machine,
	)
	const fresh = new Map(
		opts.extractMetrics(opts.report).map((m) => [m.name, m]),
	)
	const base = opts.extractMetrics(opts.baseline)
	const lines: string[] = []
	const regressedNames: string[] = []
	for (const b of base) {
		const f = fresh.get(b.name)
		if (f === undefined) {
			lines.push(`  ${b.name}: missing in fresh report (skipped)`)
			continue
		}
		const ratio = f.median / Math.max(0.0001, b.median)
		const delta = ((ratio - 1) * 100).toFixed(1)
		const bad = f.median > b.median * (1 + opts.thresholdPercent / 100)
		if (bad) regressedNames.push(b.name)
		lines.push(
			`  ${bad ? "REGRESSION " : "ok         "} ${b.name}: ${f.median.toFixed(3)}${b.unit} vs baseline ${b.median.toFixed(3)}${b.unit} (${delta}%, threshold ${opts.thresholdPercent}%)`,
		)
	}
	for (const name of fresh.keys()) {
		if (!base.some((b) => b.name === name)) {
			lines.push(`  ${name}: new metric (no baseline)`)
		}
	}
	const regressed = regressedNames.length > 0
	const message = [
		`baseline check for ${opts.suite}${regressed ? " — REGRESSION" : " — ok"}:`,
		...lines,
	].join("\n")
	return { regressed, machineMismatch, message }
}

// ── Persistence ───────────────────────────────────────────────────────────

export function loadBaseline(
	suite: string,
	baselinesDir: string = BASELINES_DIR,
): BenchReport {
	const path = join(baselinesDir, `${suite}.json`)
	let parsed: unknown
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8"))
	} catch {
		throw new Error(
			`no baseline at ${path} — run this suite with --save first (baselines are only valid on the machine that produced them)`,
		)
	}
	if (!isBenchReport(parsed) || parsed.kind !== suite) {
		throw new Error(`baseline at ${path} is not a ${suite} report`)
	}
	return parsed
}

export type BenchDirs = {
	readonly outDir: string
	readonly baselinesDir: string
}

/**
 * Write the report to `tmp/bench/`, optionally save it as the suite
 * baseline and check it against the stored one. Sets `process.exitCode`
 * to 1 when `--check` finds a regression. `dirs` is injectable for tests.
 */
export async function finishBench(opts: {
	readonly suite: string
	readonly out: string
	readonly report: BenchReport
	readonly extractMetrics: (report: BenchReport) => readonly BenchMetric[]
	readonly common: CommonArgs
	readonly dirs?: BenchDirs
}): Promise<void> {
	const dirs: BenchDirs = opts.dirs ?? {
		outDir: OUT_DIR,
		baselinesDir: BASELINES_DIR,
	}
	await mkdir(dirs.outDir, { recursive: true })
	const outPath = join(dirs.outDir, opts.out)
	await writeFile(outPath, `${JSON.stringify(opts.report, null, 2)}\n`)
	console.log(`\nwrote ${outPath}`)

	if (opts.common.save) {
		const baselinePath = join(dirs.baselinesDir, `${opts.suite}.json`)
		mkdirSync(dirs.baselinesDir, { recursive: true })
		writeFileSync(baselinePath, `${JSON.stringify(opts.report, null, 2)}\n`)
		console.log(`saved baseline ${baselinePath}`)
	}
	if (opts.common.check) {
		const baseline = loadBaseline(opts.suite, dirs.baselinesDir)
		const result = checkBaseline({
			suite: opts.suite,
			thresholdPercent: opts.common.thresholdPercent,
			report: opts.report,
			baseline,
			extractMetrics: opts.extractMetrics,
		})
		if (result.machineMismatch) {
			console.warn(
				`WARNING: baseline machine differs (fresh: ${fingerprint(opts.report.machine)} vs baseline: ${fingerprint(baseline.machine)}) — sandbox timings are not comparable across machines.`,
			)
		}
		console.log(result.message)
		if (result.regressed) {
			console.error(
				"benchmark regression detected — if the change is intentional, re-run with --save to update the baseline",
			)
			process.exitCode = 1
		}
	}
}
