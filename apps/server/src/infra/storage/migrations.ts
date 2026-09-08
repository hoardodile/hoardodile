/**
 * General storage-format migration framework.
 *
 * A structural migration bumps the persisted storage-format version (see
 * `storage-format.ts`) when it changes the on-disk layout of a library. The
 * framework runs every migration whose target format is above the library's
 * recorded format, in ascending order, at boot — before the app opens its
 * own database handles — and records the achieved format.
 *
 * Contract:
 *  - A migration is **synchronous** (`run` returns `void`). Structural
 *    migrations are quick disk/SQLite operations; the framework is called
 *    from the synchronous reset path as well as the async boot path.
 *  - `applies(ctx, current)` defaults to `current < targetFormat`. The
 *    backup-layout migration additionally recognises pre-marker libraries
 *    **structurally** (see {@link isOldLayoutLibrary}), because it is the
 *    retrofit that introduces the marker in the first place. Every future
 *    migration may rely on the numeric format alone.
 *  - `run` throwing means "unsupported library" — the error propagates to
 *    the boot/reset caller and the storage is **left unchanged** (no format
 *    stamp). Each migration is responsible for its own resumability.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import type { Env } from "src/config/env.ts"
import type { DbHandles, OpenDbOptions } from "src/infra/db/connection.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"
import { applyBackupLayout } from "./backup-layout.ts"
import { acquireStorageInstance } from "./instance-lock.ts"
import {
	CURRENT_FORMAT,
	readStorageFormat,
	writeStorageFormat,
} from "./storage-format.ts"

/** Everything a structural migration may need to do its work. */
export type MigrationContext = {
	readonly root: string
	readonly builtinDir: string
	readonly env: Env
	readonly storagePaths: StoragePaths
	readonly migrationsFolder: string
	readonly openDb: (url: string, opts?: OpenDbOptions) => DbHandles
	readonly log?: (
		msg: string,
		details?: Readonly<Record<string, unknown>>,
	) => void
}

/** One structural migration; a step from `targetFormat - 1` to `targetFormat`. */
export type StorageMigration = {
	readonly id: string
	/** The storage-format generation this migration produces. Strictly increasing. */
	readonly targetFormat: number
	readonly applies: (ctx: MigrationContext, current: number) => boolean
	readonly run: (ctx: MigrationContext) => void
}

/**
 * True when the library is on the pre-versioning ("old") layout: a live
 * `app.sqlite` at the root with no separate host database. This is the
 * structural signal the backup-layout retrofit uses because those libraries
 * predate the storage-format marker.
 */
export function isOldLayoutLibrary(root: string): boolean {
	return (
		existsSync(join(root, "app.sqlite")) &&
		!existsSync(join(root, "local", "host.sqlite"))
	)
}

export type MigrationRunResult = {
	readonly ran: ReadonlyArray<string>
	readonly format: number
	readonly changed: boolean
}

/**
 * Bring the storage at `root` up to the current format.
 *
 * The library is stamped with the achieved format on success. An unmarked
 * (pre-versioning) library is anchored at `0` when it is genuinely old, or at
 * the post-retrofit format (`CURRENT_FORMAT`, today 1) when it is already on
 * the current layout — e.g. it was converted by the old offline script, or it
 * is freshly bootstrapped — so later migrations see a correct baseline.
 *
 * @param registry optional override (tests inject a custom migration set).
 * @throws when a migration deems the library unsupported; nothing is stamped.
 */
export function runStorageMigrations(
	root: string,
	ctx: Omit<MigrationContext, "root">,
	registry: readonly StorageMigration[] = migrations,
): MigrationRunResult {
	const context: MigrationContext = { root, ...ctx }
	const marked = readStorageFormat(root)
	// An unmarked, non-old library is at the post-retrofit format; an unmarked
	// old library is at format 0. A marked library is used verbatim.
	let current =
		marked > 0 ? marked : isOldLayoutLibrary(root) ? 0 : CURRENT_FORMAT
	const ran: string[] = []
	let changed = false

	for (const migration of registry) {
		if (current >= migration.targetFormat) continue
		if (!migration.applies(context, current)) continue
		migration.run(context)
		ran.push(migration.id)
		current = migration.targetFormat
		changed = true
	}

	if (changed || readStorageFormat(root) === 0) {
		writeStorageFormat(root, current)
	}
	return { ran, format: current, changed }
}

/**
 * Run any pending storage migrations under the instance lock, then run `fn`.
 * The lock is released in all cases. Used by callers that do not already hold
 * the lock (e.g. the reset CLI); the boot path calls
 * {@link runStorageMigrations} directly because it already owns the lock.
 *
 * @throws when the lock is held by another process ("Another service already
 *   owns this storage root") or a migration deems the library unsupported.
 */
export function withStorageMigrations<T>(
	root: string,
	ctx: Omit<MigrationContext, "root">,
	fn: () => T,
): T {
	const release = acquireStorageInstance(root)
	try {
		runStorageMigrations(root, ctx)
		return fn()
	} finally {
		release()
	}
}

/**
 * The library's structural migrations, in ascending `targetFormat` order.
 * A future migration is added here with a higher `targetFormat` and its own
 * `run`; no other framework change is needed.
 */
export const migrations: readonly StorageMigration[] = [
	{
		id: "backup-layout",
		targetFormat: 1,
		applies: (ctx, current) => current < 1 && isOldLayoutLibrary(ctx.root),
		run: (ctx) => {
			applyBackupLayout({ root: ctx.root, builtinDir: ctx.builtinDir })
		},
	},
]
