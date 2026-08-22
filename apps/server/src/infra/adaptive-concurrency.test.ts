import { describe, expect, test } from "vitest"
import { createAdaptiveConcurrency } from "./adaptive-concurrency.ts"

describe("adaptive concurrency", () => {
	test("acquire blocks when limit is reached", async () => {
		const ctrl = createAdaptiveConcurrency({
			min: 1,
			max: 1,
			initial: 1,
		})

		const release1 = await ctrl.acquire()
		let acquired2 = false
		const p2 = ctrl.acquire().then((rel) => {
			acquired2 = true
			rel()
		})

		// Give the event loop a tick — p2 should still be pending.
		await new Promise((r) => setTimeout(r, 10))
		expect(acquired2).toBe(false)

		release1()
		await p2
		expect(acquired2).toBe(true)
	})

	test("limit starts at initial value", () => {
		const ctrl = createAdaptiveConcurrency({
			min: 1,
			max: 8,
			initial: 4,
		})
		expect(ctrl.get()).toBe(4)
	})

	test("increases limit when latency stays low", () => {
		const ctrl = createAdaptiveConcurrency({
			min: 1,
			max: 4,
			initial: 1,
			sampleWindow: 3,
			lowLatencyMs: 50,
			highLatencyMs: 200,
		})

		for (let i = 0; i < 3; i++) {
			ctrl.recordDuration(10)
		}
		expect(ctrl.get()).toBe(2)

		for (let i = 0; i < 3; i++) {
			ctrl.recordDuration(10)
		}
		expect(ctrl.get()).toBe(3)
	})

	test("decreases limit when latency is high", () => {
		const ctrl = createAdaptiveConcurrency({
			min: 1,
			max: 4,
			initial: 4,
			sampleWindow: 2,
			lowLatencyMs: 50,
			highLatencyMs: 100,
		})

		for (let i = 0; i < 2; i++) {
			ctrl.recordDuration(500)
		}
		expect(ctrl.get()).toBe(3)
	})

	test("limit never exceeds max or drops below min", () => {
		const ctrl = createAdaptiveConcurrency({
			min: 2,
			max: 3,
			initial: 2,
			sampleWindow: 1,
			lowLatencyMs: 1,
			highLatencyMs: 50,
		})

		// Push up
		ctrl.recordDuration(0)
		expect(ctrl.get()).toBe(3)
		ctrl.recordDuration(0)
		expect(ctrl.get()).toBe(3) // capped at max

		// Push down
		ctrl.recordDuration(100)
		expect(ctrl.get()).toBe(2)
		ctrl.recordDuration(100)
		expect(ctrl.get()).toBe(2) // capped at min
	})
})
