import { AsyncLocalStorage } from "node:async_hooks"
import { BackupError } from "./types.ts"

/** Serialize local repository mutations without disabling Restic's own repository locks. */
export function createRepositoryLocks() {
	const tails = new Map<string, Promise<unknown>>()
	const context = new AsyncLocalStorage<{ key: string; live: boolean }>()
	return {
		async run<T>(key: string, operation: () => Promise<T>): Promise<T> {
			const owner = context.getStore()
			if (owner?.key === key && owner.live) return operation()
			if (owner?.live)
				throw new BackupError(
					"lock_order",
					"Nested repository locks are not supported",
				)
			const previous = tails.get(key) ?? Promise.resolve()
			const run = previous.then(async () => {
				const lease = { key, live: true }
				try {
					return await context.run(lease, operation)
				} finally {
					lease.live = false
				}
			})
			const settled = run.catch(() => {})
			tails.set(key, settled)
			try {
				return await run
			} finally {
				if (tails.get(key) === settled) tails.delete(key)
			}
		},
		busy: (key: string) => tails.has(key),
	}
}
