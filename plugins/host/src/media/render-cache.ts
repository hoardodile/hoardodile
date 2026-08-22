/**
 * Minimal keyed task queue contract. Structural: the server's
 * `createKeyedQueue` (and the CLI's bench queue) satisfy it.
 */
export type KeyedTaskQueue<T> = {
	readonly run: (key: string, job: () => Promise<T>) => Promise<T>
}

/**
 * Cache-first render gate: return the cached result when present, else
 * run the render job through the queue — re-checking the cache inside
 * the queued task so concurrent callers coalesce onto one render.
 */
export async function withCacheAndQueue<T>(
	queue: KeyedTaskQueue<T>,
	checkCache: () => Promise<T | undefined>,
	queueKey: string,
	job: () => Promise<T>,
): Promise<T> {
	const cached = await checkCache()
	if (cached !== undefined) return cached
	return queue.run(queueKey, async () => {
		const raced = await checkCache()
		if (raced !== undefined) return raced
		return job()
	})
}
