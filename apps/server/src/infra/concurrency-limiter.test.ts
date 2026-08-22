import { describe, expect, test } from "vitest"
import { createConcurrencyLimiter } from "./concurrency-limiter.ts"

describe("concurrency limiter", () => {
	test("never runs more than max tasks at once", async () => {
		const limiter = createConcurrencyLimiter(3)
		let inFlight = 0
		let maxInFlight = 0
		const task = async () => {
			inFlight++
			maxInFlight = Math.max(maxInFlight, inFlight)
			await new Promise((resolve) => setTimeout(resolve, 5))
			inFlight--
		}
		await Promise.all(Array.from({ length: 10 }, () => limiter.run(task)))
		expect(maxInFlight).toBe(3)
	})

	test("results come back in call order of completion, values intact", async () => {
		const limiter = createConcurrencyLimiter(2)
		const results = await Promise.all(
			[1, 2, 3, 4].map((n) => limiter.run(async () => n * 2)),
		)
		expect(results).toEqual([2, 4, 6, 8])
	})

	test("a rejection releases the slot for waiting tasks", async () => {
		const limiter = createConcurrencyLimiter(1)
		await expect(
			limiter.run(async () => {
				throw new Error("boom")
			}),
		).rejects.toThrow("boom")
		// The next task must still run — the slot was released.
		await expect(limiter.run(async () => 42)).resolves.toBe(42)
	})
})
