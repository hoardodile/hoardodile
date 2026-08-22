import { readFileSync, writeFileSync } from "node:fs"
import os from "node:os"
import type { PluginManifestId } from "@hoardodile/sdk-types"
import {
	type CliHookName,
	EXIT_ERROR,
	EXIT_PASS,
	EXIT_REGRESSION,
	type HookOutcome,
} from "./runner.ts"

/**
 * Benchmark contract for hook-duration measurement and regression
 * comparison. The report shape matches the server-side bench suites in
 * apps/server/bench: the same machine fingerprint, memory peak, warmup
 * semantics, threshold gating and exit codes. See the `bench` command
 * docs.
 */

export type BenchStats = {
	readonly medianMs: number
	readonly meanMs: number
	readonly p95Ms: number
	readonly minMs: number
	readonly maxMs: number
}

/** Machine fingerprint used to gate baseline comparisons. */
export type MachineInfo = {
	readonly platform: string
	readonly arch: string
	readonly cpus: number
	readonly cpuModel: string
	readonly node: string
}

export type BenchReport = {
	readonly schema: 1
	readonly kind: "plugin-hook"
	readonly timestamp: string
	readonly config: {
		readonly pluginId: PluginManifestId
		readonly hook: CliHookName
		readonly dir: string
		readonly repeat: number
		readonly warmupRuns: number
	}
	readonly machine: MachineInfo
	readonly caveats: readonly string[]
	/** Peak host RSS observed across the measured runs. */
	readonly memoryPeakMb: number
	readonly samplesMs: readonly number[]
	readonly stats: BenchStats
}

export type BenchOptions = {
	readonly repeat: number
	/** Discarded warmup runs before the measured samples. Default 1. */
	readonly warmupRuns: number
	/** Fail (exit 1) when the median exceeds baseline × (1 + threshold/100). */
	readonly thresholdPercent: number
}

const DEFAULT_WARMUP_RUNS = 1

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

/** One warmup run is discarded so worker spawn and lazy loads never pollute samples. */
export function computeBenchReport(opts: {
	readonly pluginId: PluginManifestId
	readonly hook: CliHookName
	readonly dir: string
	readonly repeat: number
	readonly warmupRuns: number
	readonly run: () => Promise<HookOutcome>
}): Promise<BenchReport> {
	return (async () => {
		for (let i = 0; i < opts.warmupRuns; i++) {
			await opts.run()
		}
		const samples: number[] = []
		let peakRss = 0
		for (let i = 0; i < opts.repeat; i++) {
			const outcome = await opts.run()
			samples.push(outcome.durationMs)
			peakRss = Math.max(peakRss, process.memoryUsage().rss)
		}
		return {
			schema: 1,
			kind: "plugin-hook",
			timestamp: new Date().toISOString(),
			config: {
				pluginId: opts.pluginId,
				hook: opts.hook,
				dir: opts.dir,
				repeat: opts.repeat,
				warmupRuns: opts.warmupRuns,
			},
			machine: machineInfo(),
			caveats: [
				"Baselines are only valid on the same machine and environment — absolute sandbox timings (worker + protocol + probes) are not comparable across machines.",
			],
			memoryPeakMb: Math.round((peakRss / 1024 / 1024) * 10) / 10,
			samplesMs: samples,
			stats: computeStats(samples),
		}
	})()
}

export function computeStats(samples: readonly number[]): BenchStats {
	const sorted = [...samples].sort((a, b) => a - b)
	const median = sorted[Math.floor(sorted.length / 2)] ?? 0
	const mean = samples.reduce((a, b) => a + b, 0) / Math.max(1, samples.length)
	const p95 =
		sorted[Math.min(sorted.length - 1, Math.floor(sorted.length * 0.95))] ?? 0
	return {
		medianMs: round1(median),
		meanMs: round1(mean),
		p95Ms: round1(p95),
		minMs: round1(sorted[0] ?? 0),
		maxMs: round1(sorted[sorted.length - 1] ?? 0),
	}
}

export function loadBaseline(path: string): BenchReport {
	let parsed: unknown
	try {
		parsed = JSON.parse(readFileSync(path, "utf-8"))
	} catch (err) {
		throw new Error(
			`cannot read baseline file ${path}: ${err instanceof Error ? err.message : String(err)}`,
		)
	}
	if (!isBenchReport(parsed)) {
		throw new Error(
			`baseline file ${path} is not a bench report (kind plugin-hook)`,
		)
	}
	return parsed
}

function isBenchReport(value: unknown): value is BenchReport {
	if (typeof value !== "object" || value === null) return false
	const v = value as Record<string, unknown>
	if (v.schema !== 1) return false
	if (v.kind !== "plugin-hook") return false
	if (typeof v.timestamp !== "string") return false
	const config = v.config
	if (
		typeof config !== "object" ||
		config === null ||
		typeof (config as Record<string, unknown>).pluginId !== "string" ||
		typeof (config as Record<string, unknown>).hook !== "string"
	) {
		return false
	}
	const machine = v.machine
	if (
		typeof machine !== "object" ||
		machine === null ||
		typeof (machine as Record<string, unknown>).node !== "string"
	) {
		return false
	}
	const stats = v.stats
	return (
		typeof stats === "object" &&
		stats !== null &&
		typeof (stats as Record<string, unknown>).medianMs === "number"
	)
}

export type CompareResult = {
	readonly baseline: BenchReport
	readonly ratio: number
	readonly regressed: boolean
	readonly message: string
}

/** Compare a fresh report against a baseline; exit 1 on regression. */
export function compareBaseline(
	report: BenchReport,
	baseline: BenchReport,
	thresholdPercent: number,
): CompareResult {
	if (fingerprint(report.machine) !== fingerprint(baseline.machine)) {
		console.warn(
			`WARNING: baseline machine differs (fresh: ${fingerprint(report.machine)} vs baseline: ${fingerprint(baseline.machine)}) — sandbox timings are not comparable across machines.`,
		)
	}
	const ratio =
		report.stats.medianMs / Math.max(0.0001, baseline.stats.medianMs)
	const regressed =
		report.stats.medianMs >
		baseline.stats.medianMs * (1 + thresholdPercent / 100)
	const delta = ((ratio - 1) * 100).toFixed(1)
	const message = regressed
		? `REGRESSION: median ${report.stats.medianMs}ms vs baseline ${baseline.stats.medianMs}ms (${delta}%) exceeds the ${thresholdPercent}% threshold. Baselines are only valid on the same machine and environment — absolute sandbox timings (worker + protocol + probes) are not comparable across machines.`
		: `median ${report.stats.medianMs}ms vs baseline ${baseline.stats.medianMs}ms (${delta}%) — within the ${thresholdPercent}% threshold.`
	return { baseline, ratio, regressed, message }
}

export function writeReport(path: string, report: BenchReport): void {
	writeFileSync(path, `${JSON.stringify(report, null, 2)}\n`)
}

export function formatBenchSummary(report: BenchReport): string {
	const lines = [
		`hook ${report.config.hook} × ${report.config.repeat} (${report.config.warmupRuns} warmup)`,
		`plugin ${report.config.pluginId}`,
		`machine ${report.machine.platform}/${report.machine.arch} · ${report.machine.cpus} cpus (${report.machine.cpuModel}) · node ${report.machine.node} · peak rss ${report.memoryPeakMb}MB`,
		`samples: ${report.samplesMs.map((ms) => `${ms.toFixed(1)}ms`).join(" ")}`,
		`median ${report.stats.medianMs}ms · mean ${report.stats.meanMs}ms · p95 ${report.stats.p95Ms}ms · min ${report.stats.minMs}ms · max ${report.stats.maxMs}ms`,
	]
	return lines.join("\n")
}

export function benchExitCode(compare: CompareResult | undefined): number {
	if (compare === undefined) return EXIT_PASS
	return compare.regressed ? EXIT_REGRESSION : EXIT_PASS
}

export { DEFAULT_WARMUP_RUNS, EXIT_ERROR }

function round1(value: number): number {
	return Math.round(value * 10) / 10
}
