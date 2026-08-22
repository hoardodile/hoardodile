/**
 * Boot-time storage context resolver.
 *
 * Given the runtime env, this module:
 *   1. Ensures `<root>/versions/1/` exists when the storage root is empty
 *      (first-launch bootstrap of version 1).
 *   2. Reads the persisted active version (defaulting to current).
 *   3. Returns a fully-built {@link StoragePaths}, the DB path to open,
 *      and a `readOnly` flag indicating whether mutations should be
 *      forbidden (true when the user is viewing a past version).
 *
 * When `readOnly` is true, the caller MUST open `dbFilePath` (the cloned
 * snapshot under `<root>/local/cache/tmp/view-<v>.sqlite`) in `readonly: true`
 * mode and reject every mutation at the boundary.
 */

import { mkdirSync } from "node:fs"
import {
	createStoragePaths,
	ensureBootstrapVersion,
	readActiveVersion,
	currentVersion as readCurrentVersion,
	type StoragePaths,
} from "@hoardodile/host/hoard"
import type { Env } from "src/config/env.ts"
import { stageViewCloneDb } from "./version-view.ts"

export type StorageContext = {
	readonly paths: StoragePaths
	readonly dbFilePath: string
	readonly readOnly: boolean
	readonly latestVersion: number
	readonly activeVersion: number
}

/**
 * Resolve the boot-time storage context.
 *
 * Honours `env.DATABASE_URL === ":memory:"` for in-process tests (returns
 * a non-versioned context). Otherwise the DB path is fully derived from
 * the on-disk version state — `env.DATABASE_URL` is intentionally
 * ignored once `STORAGE_ROOT` is set.
 */
export function resolveStorageContext(env: Env): StorageContext {
	if (env.DATABASE_URL === ":memory:") {
		const paths = createStoragePaths({
			root: env.STORAGE_ROOT,
			activeVersion: 1,
			latestVersion: 1,
		})
		return {
			paths,
			dbFilePath: ":memory:",
			readOnly: false,
			latestVersion: 1,
			activeVersion: 1,
		}
	}
	mkdirSync(env.STORAGE_ROOT, { recursive: true })
	ensureBootstrapVersion(env.STORAGE_ROOT)
	const cur = readCurrentVersion(env.STORAGE_ROOT)
	const active = readActiveVersion(env.STORAGE_ROOT)
	const paths = createStoragePaths({
		root: env.STORAGE_ROOT,
		activeVersion: active,
		latestVersion: cur,
	})
	if (active === cur) {
		return {
			paths,
			dbFilePath: paths.runtimeDb(),
			readOnly: false,
			latestVersion: cur,
			activeVersion: active,
		}
	}
	// Past-version viewing: open a read-only clone so the immutable
	// archive is never mutated by SQLite housekeeping.
	const clonePath = stageViewCloneDb(paths, active)
	return {
		paths,
		dbFilePath: clonePath,
		readOnly: true,
		latestVersion: cur,
		activeVersion: active,
	}
}
