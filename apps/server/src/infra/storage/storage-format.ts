/**
 * Persisted storage-format version.
 *
 * The storage layout has a generation number independent of the Drizzle
 * schema journal. A structural migration (see {@link StorageMigration} in
 * `migrations.ts`) bumps this number when it changes the on-disk layout.
 * The marker is host-only state: it lives under `<root>/local/` (never
 * synced, never cleared by "clear cache") and is authoritative.
 *
 * Libraries created before this version have no marker; {@link readStorageFormat}
 * reports `0` (the "pre-versioning" format). The first structural migration
 * (the backup-layout retrofit) recognises those pre-marker libraries
 * structurally and records the current format when it (or the boot) confirms
 * the layout is already up to date.
 */

import {
	existsSync,
	mkdirSync,
	readFileSync,
	renameSync,
	writeFileSync,
} from "node:fs"
import { dirname, join } from "node:path"

/** The current (latest) storage-format generation the app writes/expects. */
export const CURRENT_FORMAT = 1

const FORMAT_FILENAME = "storage-format.json"

/** Marker path: `<root>/local/storage-format.json`. */
export function storageFormatPath(root: string): string {
	return join(root, "local", FORMAT_FILENAME)
}

/**
 * Read the persisted storage-format number. Returns `0` when the marker is
 * absent (a pre-versioning library) or unreadable/corrupt (treated as
 * unknown, so a migration may re-establish it).
 */
export function readStorageFormat(root: string): number {
	const path = storageFormatPath(root)
	if (!existsSync(path)) return 0
	try {
		const parsed = JSON.parse(readFileSync(path, "utf8")) as {
			format?: unknown
		}
		return typeof parsed.format === "number" &&
			Number.isSafeInteger(parsed.format) &&
			parsed.format >= 0
			? parsed.format
			: 0
	} catch {
		return 0
	}
}

/** Persist the storage-format number atomically (write-then-rename). */
export function writeStorageFormat(root: string, format: number): void {
	const path = storageFormatPath(root)
	mkdirSync(dirname(path), { recursive: true })
	const temp = `${path}.next`
	writeFileSync(temp, JSON.stringify({ format }), "utf8")
	renameSync(temp, path)
}
