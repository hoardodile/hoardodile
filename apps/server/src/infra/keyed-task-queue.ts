/**
 * In-process per-key task queue. Calls for the same key while a task is
 * in flight are coalesced into a single follow-up run (the queue keeps
 * the most recent factory) so a burst of upstream events doesn't spawn
 * duplicate work.
 *
 * No persistence \u2014 callers MUST be able to re-enqueue on the next
 * request after a process restart. Suitable for fire-and-forget
 * background reconciliation, not
 * suitable for cross-process or durable jobs.
 *
 * Thread-safety: Node is single-threaded, so the in-flight / pending
 * maps are race-free as long as no one awaits between the lookup and
 * the mutation \u2014 which the implementation guarantees.
 */
export type KeyedTaskQueue = {
	/**
	 * Schedule `run` for `key`. If a task is already in flight for the
	 * same key, `run` is parked as the next pending job (overwriting any
	 * earlier pending entry for the same key).
	 */
	enqueue(key: string, run: () => Promise<void>): void
	/** Wait until every enqueued task (and any chained follow-ups) settles. */
	drain(): Promise<void>
}

export function createKeyedTaskQueue(): KeyedTaskQueue {
	const inFlight = new Map<string, Promise<void>>()
	const pending = new Map<string, () => Promise<void>>()

	function schedule(key: string, run: () => Promise<void>): void {
		const promise = run().finally(() => {
			inFlight.delete(key)
			const next = pending.get(key)
			if (next !== undefined) {
				pending.delete(key)
				schedule(key, next)
			}
		})
		inFlight.set(key, promise)
	}

	async function drain(): Promise<void> {
		while (inFlight.size > 0 || pending.size > 0) {
			await Promise.all(inFlight.values())
		}
	}

	return {
		enqueue(key, run) {
			if (inFlight.has(key)) {
				pending.set(key, run)
				return
			}
			schedule(key, run)
		},
		drain,
	}
}
