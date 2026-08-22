import { describe, expect, test } from "vitest"
import { createProbeCache } from "./probe-cache.ts"

describe("probe cache", () => {
	test("a miss computes once and hits afterwards", async () => {
		const cache = createProbeCache()
		let calls = 0
		const compute = async () => {
			calls++
			return { width: 1 }
		}
		await expect(cache.getOrCompute("a", compute)).resolves.toEqual({
			width: 1,
		})
		await expect(cache.getOrCompute("a", compute)).resolves.toEqual({
			width: 1,
		})
		expect(calls).toBe(1)
	})

	test("concurrent misses for the same key single-flight", async () => {
		const cache = createProbeCache()
		let calls = 0
		const compute = async () => {
			calls++
			await new Promise((resolve) => setTimeout(resolve, 10))
			return true
		}
		const [a, b] = await Promise.all([
			cache.getOrCompute("k", compute),
			cache.getOrCompute("k", compute),
		])
		expect(a).toBe(true)
		expect(b).toBe(true)
		expect(calls).toBe(1)
	})

	test("undefined results are cached too", async () => {
		const cache = createProbeCache()
		let calls = 0
		const compute = async () => {
			calls++
			return undefined
		}
		await expect(cache.getOrCompute("x", compute)).resolves.toBeUndefined()
		await expect(cache.getOrCompute("x", compute)).resolves.toBeUndefined()
		expect(calls).toBe(1)
	})

	test("rejections are not cached — the next caller retries", async () => {
		const cache = createProbeCache()
		let calls = 0
		const failing = async (): Promise<{ width: number }> => {
			calls++
			throw new Error("transient")
		}
		await expect(cache.getOrCompute("x", failing)).rejects.toThrow("transient")
		// Let the rejection cleanup land.
		await new Promise((resolve) => setTimeout(resolve, 0))
		await expect(
			cache.getOrCompute("x", async () => ({ width: 2 })),
		).resolves.toEqual({ width: 2 })
		expect(calls).toBe(1)
	})

	test("evicts the least recently used entry beyond the bound", async () => {
		const cache = createProbeCache(2)
		const compute = async () => true
		await cache.getOrCompute("a", compute)
		await cache.getOrCompute("b", compute)
		// Touch "a" so "b" becomes the eviction candidate.
		await cache.getOrCompute("a", compute)
		await cache.getOrCompute("c", compute)

		let aCalls = 0
		await cache.getOrCompute("a", async () => {
			aCalls++
			return true
		})
		expect(aCalls).toBe(0) // "a" survived as recently used

		let bCalls = 0
		await cache.getOrCompute("b", async () => {
			bCalls++
			return true
		})
		expect(bCalls).toBe(1) // "b" was evicted and recomputed
	})
})
