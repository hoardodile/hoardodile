import type { PluginHooks } from "@hoardodile/host"
import { describe, expect, test, vi } from "vitest"
import { createAdaptiveConcurrency } from "../src/infra/adaptive-concurrency.ts"
import {
	countHooks,
	mulberry32,
	randomBytes,
	runPhase,
	summarizeMetric,
	summarizeSamples,
	withDetectTiming,
} from "./harness.ts"

describe("mulberry32 / randomBytes", () => {
	test("is deterministic per seed", () => {
		expect(randomBytes(42, 64)).toEqual(randomBytes(42, 64))
		expect(randomBytes(1, 64)).not.toEqual(randomBytes(2, 64))
	})

	test("produces the requested length", () => {
		expect(randomBytes(7, 1024)).toHaveLength(1024)
	})

	test("mulberry32 stays in [0, 1)", () => {
		const rand = mulberry32(1)
		for (let i = 0; i < 1000; i++) {
			const v = rand()
			expect(v).toBeGreaterThanOrEqual(0)
			expect(v).toBeLessThan(1)
		}
	})
})

describe("summarizeMetric", () => {
	test("empty input yields zeros", () => {
		expect(summarizeMetric([])).toEqual({ median: 0, min: 0, max: 0 })
	})

	test("single sample", () => {
		expect(summarizeMetric([5])).toEqual({ median: 5, min: 5, max: 5 })
	})

	test("median is the upper-middle element", () => {
		expect(summarizeMetric([3, 1, 2])).toEqual({ median: 2, min: 1, max: 3 })
		expect(summarizeMetric([1, 2])).toEqual({ median: 2, min: 1, max: 2 })
	})
})

describe("summarizeSamples", () => {
	test("empty input yields zeros", () => {
		expect(summarizeSamples([])).toEqual({ mean: 0, p95: 0, min: 0, max: 0 })
	})

	test("single sample", () => {
		expect(summarizeSamples([5])).toEqual({ mean: 5, p95: 5, min: 5, max: 5 })
	})

	test("mean and p95 index math", () => {
		expect(summarizeSamples([1, 2, 3, 4])).toEqual({
			mean: 2.5,
			p95: 4,
			min: 1,
			max: 4,
		})
	})
})

describe("runPhase", () => {
	const item = (id: string) => ({ id })

	test("pages until empty and counts successes", async () => {
		let pages = 0
		const result = await runPhase(
			async (page) => {
				pages++
				if (page > 2) return { rows: [], total: 0, page, size: 2 } as const
				return {
					rows: [item(`a${page}1`), item(`a${page}2`)],
					total: 4,
					page,
					size: 2,
				} as const
			},
			async () => {},
			createAdaptiveConcurrency({ max: 2, initial: 2 }),
			"test",
		)
		expect(pages).toBe(3)
		expect(result.items).toBe(4)
		expect(result.succeeded).toBe(4)
		expect(result.failed).toBe(0)
		expect(result.errors).toEqual([])
		expect(result.wallMs).toBeGreaterThan(0)
		expect(result.itemsPerSec).toBeGreaterThan(0)
		expect(result.memoryPeakMb).toBeGreaterThan(0)
		expect(result.stepMs).toEqual({})
	})

	test("accumulates step timings via the timed helper", async () => {
		const result = await runPhase(
			async (page) =>
				page === 1
					? ({ rows: [item("x")], total: 1, page, size: 1 } as const)
					: ({ rows: [], total: 1, page, size: 1 } as const),
			async (_item, timed) => {
				await timed("first", async () => {})
				await timed("second", async () => {})
			},
			createAdaptiveConcurrency({ max: 1, initial: 1 }),
			"test",
		)
		expect(result.succeeded).toBe(1)
		expect(result.stepMs.first).toBeGreaterThan(0)
		expect(result.stepMs.second).toBeGreaterThan(0)
		expect(result.stepMs.first! + result.stepMs.second!).toBeGreaterThan(0)
	})

	test("per-item samples feed perItemMs and errors truncate to 10", async () => {
		const rows = Array.from({ length: 12 }, (_, i) => item(`e${i}`))
		const result = await runPhase(
			async (page) =>
				page === 1
					? ({ rows, total: 12, page, size: 12 } as const)
					: ({ rows: [], total: 12, page, size: 12 } as const),
			async (it) => {
				throw new Error(`boom ${it.id}`)
			},
			createAdaptiveConcurrency({ max: 4, initial: 4 }),
			"test",
		)
		expect(result.failed).toBe(12)
		expect(result.succeeded).toBe(0)
		expect(result.errors).toHaveLength(10)
		expect(result.errors[0]?.error).toMatch(/^boom e/)
	})

	test("progress log fires every 50 processed items", async () => {
		const spy = vi.spyOn(console, "log").mockImplementation(() => {})
		try {
			const rows = Array.from({ length: 60 }, (_, i) => item(`p${i}`))
			await runPhase(
				async (page) =>
					page === 1
						? ({ rows, total: 60, page, size: 60 } as const)
						: ({ rows: [], total: 60, page, size: 60 } as const),
				async () => {},
				createAdaptiveConcurrency({ max: 8, initial: 8 }),
				"label",
			)
			const progressLines = spy.mock.calls.filter((c) =>
				String(c[0]).includes("[label] 50/60 processed"),
			)
			expect(progressLines).toHaveLength(1)
		} finally {
			spy.mockRestore()
		}
	})
})

describe("withDetectTiming", () => {
	test("accumulates detectFirstMatch wall time and resets", async () => {
		const fake = {
			detectFirstMatch: async () => {
				await new Promise((r) => setTimeout(r, 5))
				return "detected"
			},
		} as unknown as PluginHooks
		const { hooks, reset, detectMs } = withDetectTiming(fake)

		await hooks.detectFirstMatch({} as never)
		await hooks.detectFirstMatch({} as never)
		expect(detectMs()).toBeGreaterThan(0)
		expect(detectMs()).toBeGreaterThanOrEqual(5)
		reset()
		expect(detectMs()).toBe(0)
	})

	test("passes through the wrapped result", async () => {
		const fake = {
			detectFirstMatch: async () => "hello",
		} as unknown as PluginHooks
		const { hooks } = withDetectTiming(fake)
		await expect(hooks.detectFirstMatch({} as never)).resolves.toBe("hello")
	})
})

describe("countHooks", () => {
	test("counts calls and wall time per method, reset and snapshot", async () => {
		const fake = {
			detectFirstMatch: async () => {
				await new Promise((r) => setTimeout(r, 3))
				return "ok"
			},
		} as unknown as PluginHooks
		const { hooks, reset, snapshot } = countHooks(fake)

		await hooks.detectFirstMatch({} as never)
		await hooks.detectFirstMatch({} as never)
		let snap = snapshot()
		expect(snap.totalCalls).toBe(2)
		expect(snap.byMethod.detectFirstMatch?.calls).toBe(2)
		expect(snap.byMethod.detectFirstMatch?.ms).toBeGreaterThanOrEqual(3)

		reset()
		snap = snapshot()
		expect(snap.totalCalls).toBe(0)
		expect(snap.totalMs).toBe(0)
	})
})
