/**
 * In-process concurrency limiter. Tasks beyond `max` wait in FIFO order
 * until a slot frees. Used to bound background fan-out (e.g. per-resource
 * meta rebuilds after a cold start) so a burst doesn't stampede shared
 * resources like the single per-plugin worker.
 */
export type ConcurrencyLimiter = {
	/** Run `fn` once a slot is free. Rejections release the slot. */
	readonly run: <T>(fn: () => Promise<T>) => Promise<T>
}

export function createConcurrencyLimiter(max: number): ConcurrencyLimiter {
	let running = 0
	const waiters: (() => void)[] = []

	async function run<T>(fn: () => Promise<T>): Promise<T> {
		if (running >= max) {
			await new Promise<void>((resolve) => {
				waiters.push(resolve)
			})
		}
		running++
		try {
			return await fn()
		} finally {
			running--
			const next = waiters.shift()
			if (next !== undefined) next()
		}
	}

	return { run }
}
