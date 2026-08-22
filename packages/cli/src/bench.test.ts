import { describe, expect, test } from "vitest"
import { computeBenchReport, computeStats, machineInfo } from "./bench.ts"

describe("computeStats", () => {
	test("computes median, mean, p95, min and max", () => {
		const stats = computeStats([10, 20, 30, 40, 50])
		expect(stats).toEqual({
			medianMs: 30,
			meanMs: 30,
			p95Ms: 50,
			minMs: 10,
			maxMs: 50,
		})
	})

	test("handles a single sample", () => {
		const stats = computeStats([7])
		expect(stats.medianMs).toBe(7)
		expect(stats.p95Ms).toBe(7)
	})
})

describe("computeBenchReport", () => {
	test("discards warmup runs and reports the measured samples", async () => {
		const calls: string[] = []
		const report = await computeBenchReport({
			pluginId: "11111111-1111-4111-8111-111111111111",
			hook: "detect",
			dir: "d",
			repeat: 3,
			warmupRuns: 1,
			run: async () => {
				calls.push("run")
				return { ok: true, result: "r", durationMs: 1 }
			},
		})
		expect(calls).toHaveLength(4)
		expect(report).toMatchObject({
			schema: 1,
			kind: "plugin-hook",
			config: { repeat: 3, warmupRuns: 1 },
			samplesMs: [1, 1, 1],
			stats: { medianMs: 1 },
			machine: machineInfo(),
			memoryPeakMb: expect.any(Number),
		})
	})

	test("honours a custom warmup count", async () => {
		let calls = 0
		const report = await computeBenchReport({
			pluginId: "11111111-1111-4111-8111-111111111111",
			hook: "detect",
			dir: "d",
			repeat: 2,
			warmupRuns: 3,
			run: async () => {
				calls++
				return { ok: true, result: "r", durationMs: 1 }
			},
		})
		expect(calls).toBe(5)
		expect(report.config.warmupRuns).toBe(3)
	})
})
