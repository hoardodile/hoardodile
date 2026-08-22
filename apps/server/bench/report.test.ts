import {
	mkdirSync,
	mkdtempSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, describe, expect, test } from "vitest"
import { parseCommonArgs } from "./args.ts"
import {
	type BenchMetric,
	type BenchReport,
	type CheckOptions,
	checkBaseline,
	finishBench,
	isBenchReport,
	loadBaseline,
} from "./report.ts"

const metric = (name: string, median: number): BenchMetric => ({
	name,
	unit: "ms",
	median,
	min: median,
	max: median,
})

const extract = (report: BenchReport) =>
	(report.metrics as readonly BenchMetric[]) ?? []

const MACHINE = {
	platform: "linux",
	arch: "x64",
	cpus: 2,
	cpuModel: "cpu-a",
	node: "v24",
}

function reportFixture(
	metrics: readonly BenchMetric[] = [metric("a", 10)],
): BenchReport {
	return {
		schema: 1,
		kind: "test",
		timestamp: "t",
		config: {},
		machine: MACHINE,
		caveats: [],
		memoryPeakMb: 1,
		metrics,
	}
}

function check(
	overrides: Partial<Omit<CheckOptions, "report" | "baseline">> & {
		report?: BenchReport
		baseline?: BenchReport
	} = {},
): ReturnType<typeof checkBaseline> {
	return checkBaseline({
		suite: "test",
		thresholdPercent: 25,
		report: reportFixture(),
		baseline: reportFixture(),
		extractMetrics: extract,
		...overrides,
	})
}

describe("checkBaseline", () => {
	test("identical medians pass", () => {
		const r = check()
		expect(r.regressed).toBe(false)
		expect(r.machineMismatch).toBe(false)
		expect(r.message).toContain("baseline check for test — ok")
		expect(r.message).toContain("ok          a: 10.000ms vs baseline 10.000ms")
	})

	test("fails when the fresh median exceeds the threshold", () => {
		const over = check({ report: reportFixture([metric("a", 12.6)]) })
		expect(over.regressed).toBe(true)
		expect(over.message).toContain(
			"REGRESSION  a: 12.600ms vs baseline 10.000ms (26.0%",
		)
	})

	test("threshold boundary is strict (equal does not regress)", () => {
		const r = check({ report: reportFixture([metric("a", 12.5)]) })
		expect(r.regressed).toBe(false)
	})

	test("zero baseline median uses a floor denominator", () => {
		const r = check({ baseline: reportFixture([metric("a", 0)]) })
		expect(r.regressed).toBe(true)
	})

	test("metrics missing in the fresh report are skipped, new ones reported", () => {
		const r = check({
			report: reportFixture([metric("a", 10), metric("new", 1)]),
		})
		expect(r.regressed).toBe(false)
		expect(r.message).toContain("new: new metric (no baseline)")
		const r2 = check({ report: reportFixture([metric("b", 10)]) })
		expect(r2.message).toContain("a: missing in fresh report (skipped)")
		expect(r2.regressed).toBe(false)
	})

	test("flags a machine mismatch without failing the comparison", () => {
		const r = check({
			report: { ...reportFixture(), machine: { ...MACHINE, cpus: 16 } },
		})
		expect(r.machineMismatch).toBe(true)
		expect(r.regressed).toBe(false)
	})
})

describe("isBenchReport", () => {
	test("accepts a well-formed report", () => {
		expect(isBenchReport(reportFixture())).toBe(true)
	})

	test("rejects malformed values", () => {
		expect(isBenchReport(null)).toBe(false)
		expect(isBenchReport({})).toBe(false)
		expect(isBenchReport({ ...reportFixture(), schema: 2 })).toBe(false)
		expect(isBenchReport({ ...reportFixture(), kind: 1 })).toBe(false)
		expect(
			isBenchReport({ ...reportFixture(), machine: "not-a-machine" }),
		).toBe(false)
		expect(isBenchReport({ ...reportFixture(), memoryPeakMb: "x" })).toBe(false)
	})
})

describe("loadBaseline / finishBench", () => {
	let dirs: { outDir: string; baselinesDir: string } | undefined

	afterEach(() => {
		if (dirs !== undefined) {
			rmSync(dirs.outDir, { recursive: true, force: true })
			rmSync(dirs.baselinesDir, { recursive: true, force: true })
			dirs = undefined
		}
	})

	function tempDirs(): { outDir: string; baselinesDir: string } {
		const root = mkdtempSync(join(tmpdir(), "bench-report-test-"))
		dirs = { outDir: join(root, "out"), baselinesDir: join(root, "baselines") }
		mkdirSync(dirs.baselinesDir, { recursive: true })
		return dirs
	}

	test("warns via finishBench when machines differ", async () => {
		const d = tempDirs()
		writeJson(join(d.baselinesDir, "test.json"), reportFixture())
		const { warn } = console
		const warnings: string[] = []
		console.warn = (...args: unknown[]) => {
			warnings.push(String(args[0]))
		}
		try {
			await finishBench({
				suite: "test",
				out: "baseline.json",
				report: { ...reportFixture(), machine: { ...MACHINE, cpus: 16 } },
				extractMetrics: extract,
				common: parseCommonArgs(["--check"]),
				dirs: d,
			})
			expect(warnings.some((w) => w.includes("baseline machine differs"))).toBe(
				true,
			)
		} finally {
			console.warn = warn
		}
	})

	test("loadBaseline reads a saved report and validates kind", () => {
		const d = tempDirs()
		writeJson(join(d.baselinesDir, "test.json"), reportFixture())
		expect(loadBaseline("test", d.baselinesDir).kind).toBe("test")

		writeJson(join(d.baselinesDir, "other.json"), {
			...reportFixture(),
			kind: "io",
		})
		expect(() => loadBaseline("other", d.baselinesDir)).toThrow(
			"is not a other report",
		)
	})

	test("loadBaseline reports a missing file", () => {
		const d = tempDirs()
		expect(() => loadBaseline("nope", d.baselinesDir)).toThrow("no baseline at")
	})

	test("finishBench writes the report out and saves the baseline", async () => {
		const d = tempDirs()
		const report = reportFixture()
		await finishBench({
			suite: "test",
			out: "baseline.json",
			report,
			extractMetrics: extract,
			common: parseCommonArgs(["--save"]),
			dirs: d,
		})
		expect(
			JSON.parse(readFileSync(join(d.outDir, "baseline.json"), "utf-8")),
		).toEqual(report)
		expect(
			JSON.parse(readFileSync(join(d.baselinesDir, "test.json"), "utf-8")),
		).toEqual(report)
	})

	test("finishBench --check sets exit code 1 on regression and 0 otherwise", async () => {
		const d = tempDirs()
		writeJson(join(d.baselinesDir, "test.json"), reportFixture())

		process.exitCode = 0
		await finishBench({
			suite: "test",
			out: "baseline.json",
			report: reportFixture(),
			extractMetrics: extract,
			common: parseCommonArgs(["--check"]),
			dirs: d,
		})
		expect(process.exitCode).toBe(0)

		await finishBench({
			suite: "test",
			out: "baseline.json",
			report: reportFixture([metric("a", 99)]),
			extractMetrics: extract,
			common: parseCommonArgs(["--check"]),
			dirs: d,
		})
		expect(process.exitCode).toBe(1)
		process.exitCode = 0
	})
})

function writeJson(path: string, value: unknown): void {
	writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`)
}
