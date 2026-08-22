import type { DbHandles, SqliteDb } from "src/infra/db/connection.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"

/**
 * A simple mutable reference used to implement hot-swappable runtime
 * dependencies. The server process keeps running while the underlying
 * SQLite handle and storage paths are replaced after a version switch
 * or backup restore.
 */
export type MutableRef<T> = {
	current: T
}

export function createMutableRef<T>(initial: T): MutableRef<T> {
	return { current: initial }
}

/**
 * Bundle of refs that together define the current storage context.
 */
export type RuntimeRefs = {
	readonly dbHandles: MutableRef<DbHandles>
	readonly storagePaths: MutableRef<StoragePaths>
	readonly readOnly: MutableRef<boolean>
}

export function createRuntimeRefs(initial: {
	readonly dbHandles: DbHandles
	readonly storagePaths: StoragePaths
	readonly readOnly: boolean
}): RuntimeRefs {
	return {
		dbHandles: createMutableRef(initial.dbHandles),
		storagePaths: createMutableRef(initial.storagePaths),
		readOnly: createMutableRef(initial.readOnly),
	}
}

/**
 * A promise with external resolvers, used to park HTTP requests while the
 * storage context is being reloaded.
 */
export type Deferred<T> = {
	readonly promise: Promise<T>
	resolve(value: T): void
	reject(reason?: unknown): void
}

export function createDeferred<T>(): Deferred<T> {
	let resolve: (value: T) => void = () => {}
	let reject: (reason?: unknown) => void = () => {}
	const promise = new Promise<T>((res, rej) => {
		resolve = res
		reject = rej
	})
	return { promise, resolve, reject }
}

/**
 * Build a Proxy over {@link SqliteDb} that always forwards property access
 * to the current value of `ref`. This lets domain service closures created
 * at startup keep using the same `db` object while the underlying handle
 * is swapped during a storage context reload.
 */
export function createDbProxy(ref: MutableRef<DbHandles>): SqliteDb {
	return new Proxy({} as SqliteDb, {
		get(_target, prop) {
			const currentDb = ref.current.db
			const value = currentDb[prop as keyof SqliteDb]
			if (typeof value === "function") {
				return value.bind(currentDb)
			}
			return value
		},
	})
}

/**
 * Build a Proxy over {@link DbHandles} that forwards to the current handle.
 * Used by backup/version services that call `vacuumInto`, `integrityCheck`,
 * etc.
 */
export function createDbHandlesProxy(ref: MutableRef<DbHandles>): DbHandles {
	return new Proxy({} as DbHandles, {
		get(_target, prop) {
			const current = ref.current
			const value = current[prop as keyof DbHandles]
			if (typeof value === "function") {
				return value.bind(current)
			}
			return value
		},
	})
}

/**
 * Build a Proxy over {@link StoragePaths} that forwards to the current paths.
 * Version changes alter `activeVersion` / `latestVersion`, so services that
 * captured `app.paths` at startup must see the new values after a reload.
 */
export function createStoragePathsProxy(
	ref: MutableRef<StoragePaths>,
): StoragePaths {
	return new Proxy({} as StoragePaths, {
		get(_target, prop) {
			const current = ref.current
			const value = current[prop as keyof StoragePaths]
			if (typeof value === "function") {
				return value.bind(current)
			}
			return value
		},
	})
}
