import { describe, expect, test } from "vitest"
import { createKeyedQueue } from "./queue.ts"

describe("createKeyedQueue", () => {
	test("coalesces concurrent callers onto one job per key", async () => {
		const q = createKeyedQueue<number>({ concurrency: 2 })
		let runs = 0
		let resolver: ((value: number) => void) | undefined
		const job = () =>
			new Promise<number>((resolve) => {
				runs += 1
				resolver = resolve
			})

		const a = q.run("k", job)
		const b = q.run("k", job)
		const c = q.run("k", job)

		// Drain microtasks so the job body gets a chance to start.
		await Promise.resolve()
		await Promise.resolve()

		// All three callers must see the same in-flight promise; the job
		// body ran exactly once.
		expect(runs).toBe(1)
		resolver?.(42)
		await expect(a).resolves.toBe(42)
		await expect(b).resolves.toBe(42)
		await expect(c).resolves.toBe(42)
	})

	test("releases the key after completion so a later run re-enters", async () => {
		const q = createKeyedQueue<number>({ concurrency: 1 })
		let runs = 0
		await q.run("k", async () => {
			runs += 1
			return 1
		})
		await q.run("k", async () => {
			runs += 1
			return 2
		})
		expect(runs).toBe(2)
	})

	test("respects concurrency across distinct keys", async () => {
		const q = createKeyedQueue<number>({ concurrency: 2 })
		const gates = [makeGate(), makeGate(), makeGate()] as const
		const runs: [number, number, number] = [0, 0, 0]
		const p0 = q.run("a", async () => {
			runs[0] += 1
			await gates[0].promise
			return 0
		})
		const p1 = q.run("b", async () => {
			runs[1] += 1
			await gates[1].promise
			return 1
		})
		const p2 = q.run("c", async () => {
			runs[2] += 1
			await gates[2].promise
			return 2
		})
		// Yield so the scheduler drains its microtasks.
		await Promise.resolve()
		await Promise.resolve()
		expect(runs[0]).toBe(1)
		expect(runs[1]).toBe(1)
		expect(runs[2]).toBe(0)
		gates[0].open()
		await p0
		// After the first slot frees, `c` must take it.
		await Promise.resolve()
		await Promise.resolve()
		expect(runs[2]).toBe(1)
		gates[1].open()
		gates[2].open()
		await Promise.all([p1, p2])
	})

	test("throws for concurrency < 1", () => {
		expect(() => createKeyedQueue({ concurrency: 0 })).toThrow(/concurrency/)
	})

	test("failed job frees the key so a retry can re-enter", async () => {
		const q = createKeyedQueue<number>({ concurrency: 1 })
		await expect(
			q.run("k", async () => {
				throw new Error("boom")
			}),
		).rejects.toThrow("boom")
		const result = await q.run("k", async () => 7)
		expect(result).toBe(7)
	})
})

function makeGate(): { promise: Promise<void>; open: () => void } {
	let open!: () => void
	const promise = new Promise<void>((resolve) => {
		open = resolve
	})
	return { promise, open }
}
