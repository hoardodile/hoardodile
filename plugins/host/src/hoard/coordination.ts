import { AsyncLocalStorage } from "node:async_hooks"
import { resolve } from "node:path"

type Lease = { root: string; live: boolean }
const context = new AsyncLocalStorage<Lease>()
const requests = new AsyncLocalStorage<{
	signal: AbortSignal
	waiting: (value: boolean) => void
}>()
const coordinators = new Map<string, StorageCoordinator>()

export function withStorageRequest<T>(
	options: { signal: AbortSignal; waiting: (value: boolean) => void },
	operation: () => T,
): T {
	return requests.run(options, operation)
}

export type StorageCoordinator = {
	readonly state: () => {
		frozen: boolean
		writers: number
		waiting: number
		revision: number
	}
	write<T>(operation: () => T | Promise<T>): Promise<T>
	freeze<T>(options: {
		operation: () => T | Promise<T>
		signal?: AbortSignal
		timeoutMs?: number
	}): Promise<T>
}

export function withFileCommit<Args extends unknown[], Result>(
	root: string,
	operation: (...args: Args) => Result | Promise<Result>,
): (...args: Args) => Promise<Result> {
	return (...args) => storageCoordinator(root).write(() => operation(...args))
}

/** One coordinator per root, shared by application commits and host file writes. */
export function storageCoordinator(root: string): StorageCoordinator {
	const key =
		process.platform === "win32" ? resolve(root).toLowerCase() : resolve(root)
	const existing = coordinators.get(key)
	if (existing) return existing
	let writers = 0
	let frozen = false
	let waiting = 0
	let revision = 0
	let tail: Promise<unknown> = Promise.resolve()
	const listeners = new Set<() => void>()
	const wake = () => {
		for (const listener of [...listeners]) listener()
	}
	const ownsLease = () => {
		const lease = context.getStore()
		return lease?.root === key && lease.live
	}
	async function changed(signal?: AbortSignal): Promise<void> {
		if (signal?.aborted) throw new Error("Storage operation cancelled")
		await new Promise<void>((done, fail) => {
			const cleanup = () => {
				listeners.delete(onChange)
				signal?.removeEventListener("abort", onAbort)
			}
			const onChange = () => {
				cleanup()
				done()
			}
			const onAbort = () => {
				cleanup()
				fail(new Error("Storage operation cancelled"))
			}
			listeners.add(onChange)
			signal?.addEventListener("abort", onAbort, { once: true })
		})
	}
	const coordinator: StorageCoordinator = {
		state: () => ({ frozen, writers, waiting, revision }),
		async write(operation) {
			if (ownsLease()) return await operation()
			const request = requests.getStore()
			request?.signal.throwIfAborted()
			waiting++
			const announced = frozen
			if (announced) request?.waiting(true)
			try {
				while (frozen) await changed(request?.signal)
			} finally {
				waiting--
				if (announced) request?.waiting(false)
			}
			request?.signal.throwIfAborted()
			writers++
			const lease: Lease = { root: key, live: true }
			try {
				return await context.run(lease, operation)
			} finally {
				lease.live = false
				writers--
				revision++
				wake()
			}
		},
		freeze(options) {
			if (ownsLease())
				return Promise.reject(
					new Error("Cannot freeze storage inside a file commit"),
				)
			const run = tail.then(async () => {
				options.signal?.throwIfAborted()
				frozen = true
				const timeout = AbortSignal.timeout(options.timeoutMs ?? 60_000)
				const signal = options.signal
					? AbortSignal.any([options.signal, timeout])
					: timeout
				const lease: Lease = { root: key, live: true }
				try {
					while (writers > 0) await changed(signal)
					options.signal?.throwIfAborted()
					return await context.run(lease, options.operation)
				} finally {
					lease.live = false
					frozen = false
					wake()
				}
			})
			tail = run.catch(() => {})
			return run
		},
	}
	coordinators.set(key, coordinator)
	return coordinator
}
