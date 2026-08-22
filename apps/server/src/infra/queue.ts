/**
 * Coalescing queue with bounded concurrency.
 * Requests for the same key share one in-flight promise.
 */

export type KeyedQueue<T> = {
	/** Return the promise for `key`; runs `job` only if no task is in-flight for it. */
	run(key: string, job: () => Promise<T>): Promise<T>
	/**
	 * Return the in-flight promise for `key` without starting a new job.
	 * Returns `undefined` when no task is running for that key.
	 */
	join(key: string): Promise<T> | undefined
	/** Number of keys currently in flight (running or queued). */
	readonly inflight: number
}

export type KeyedQueueOptions = {
	readonly concurrency: number | { readonly get: () => number }
	/** Called with the task duration (ms) after a queued job finishes. */
	readonly onTaskComplete?: (ms: number) => void
}

export function createKeyedQueue<T>(opts: KeyedQueueOptions): KeyedQueue<T> {
	const resolved =
		typeof opts.concurrency === "number"
			? opts.concurrency
			: opts.concurrency.get()
	if (resolved < 1) {
		throw new Error(`keyed queue concurrency must be >= 1 (got ${resolved})`)
	}
	const active = new Map<string, Promise<T>>()
	const waiting: Array<() => void> = []
	let running = 0

	function getLimit(): number {
		return typeof opts.concurrency === "number"
			? opts.concurrency
			: opts.concurrency.get()
	}

	function acquire(): Promise<void> {
		if (running < getLimit()) {
			running += 1
			return Promise.resolve()
		}
		return new Promise((resolve) => {
			waiting.push(() => {
				running += 1
				resolve()
			})
		})
	}

	function release(): void {
		running -= 1
		const next = waiting.shift()
		if (next) next()
	}

	async function run(key: string, job: () => Promise<T>): Promise<T> {
		const existing = active.get(key)
		if (existing !== undefined) return existing
		const start = performance.now()
		const promise = (async () => {
			await acquire()
			try {
				return await job()
			} finally {
				release()
				active.delete(key)
				opts.onTaskComplete?.(performance.now() - start)
			}
		})()
		active.set(key, promise)
		return promise
	}

	function join(key: string): Promise<T> | undefined {
		return active.get(key)
	}

	return {
		run,
		join,
		get inflight() {
			return active.size
		},
	}
}
