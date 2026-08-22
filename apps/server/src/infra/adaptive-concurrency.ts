import os from "node:os"

export type AdaptiveConcurrencyOptions = {
	/** Minimum concurrency limit. Defaults to 1. */
	readonly min?: number
	/** Maximum concurrency limit. Defaults to `os.cpus().length * 2`. */
	readonly max?: number
	/** Starting limit. Defaults to `Math.max(min, max - 1)`. */
	readonly initial?: number
	/** Number of task-duration samples per adjustment window. Defaults to 10. */
	readonly sampleWindow?: number
	/** If average duration in a window exceeds this, decrease limit. Defaults to 800. */
	readonly highLatencyMs?: number
	/** If average duration in a window falls below this, increase limit. Defaults to 150. */
	readonly lowLatencyMs?: number
}

export type AdaptiveConcurrency = {
	/** Read the current concurrency limit (may change over time). */
	get(): number
	/** Acquire a slot. Returns a release function that MUST be called when the task finishes. */
	acquire(): Promise<() => void>
	/** Report how long a task took so the controller can tune the limit. */
	recordDuration(ms: number): void
}

export function createAdaptiveConcurrency(
	opts?: AdaptiveConcurrencyOptions,
): AdaptiveConcurrency {
	const max = opts?.max ?? os.cpus().length * 2
	const min = opts?.min ?? 1
	const initial = opts?.initial ?? Math.max(min, max - 1)
	const sampleWindow = opts?.sampleWindow ?? 10
	const highLatencyMs = opts?.highLatencyMs ?? 800
	const lowLatencyMs = opts?.lowLatencyMs ?? 150

	let limit = Math.max(min, Math.min(initial, max))
	let running = 0
	const waiting: Array<() => void> = []
	const samples: number[] = []

	function getLimit(): number {
		return limit
	}

	function acquire(): Promise<() => void> {
		if (running < getLimit()) {
			running += 1
			return Promise.resolve(makeRelease())
		}
		return new Promise((resolve) => {
			waiting.push(() => {
				running += 1
				resolve(makeRelease())
			})
		})
	}

	function makeRelease(): () => void {
		let released = false
		return () => {
			if (released) return
			released = true
			running -= 1
			const next = waiting.shift()
			if (next) next()
		}
	}

	function recordDuration(ms: number): void {
		samples.push(ms)
		if (samples.length < sampleWindow) return

		const avg = samples.reduce((a, b) => a + b, 0) / samples.length
		samples.length = 0

		if (avg < lowLatencyMs && limit < max) {
			limit += 1
		} else if (avg > highLatencyMs && limit > min) {
			limit -= 1
		}
	}

	return {
		get() {
			return limit
		},
		acquire,
		recordDuration,
	}
}
