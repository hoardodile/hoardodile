/**
 * In-memory record of in-flight plugin container extractions, keyed by
 * resource id. Written by the `extractArchive` progress callback and
 * read by the `/api/resources/:id/extract-progress` route so the reader
 * can show how far a first-time materialization has come. Entries expire
 * shortly after their last update — progress is only meaningful while a
 * hook is actually running.
 */

const PROGRESS_TTL_MS = 30_000

export type ExtractProgressRow = {
	readonly done: number
	readonly total: number
	readonly updatedAt: number
}

export type ExtractProgressStore = {
	/** Record (or refresh) the progress of `resId`'s extraction. */
	readonly record: (resId: string, progress: ExtractProgressRow) => void
	/** Latest progress for `resId`, or `undefined` when nothing is
	 *  running (or the record went stale). */
	readonly read: (resId: string) => ExtractProgressRow | undefined
}

export function createExtractProgressStore(): ExtractProgressStore {
	const rows = new Map<string, ExtractProgressRow>()

	function record(resId: string, progress: ExtractProgressRow): void {
		rows.set(resId, progress)
	}

	function read(resId: string): ExtractProgressRow | undefined {
		const row = rows.get(resId)
		if (row === undefined) return undefined
		if (Date.now() - row.updatedAt > PROGRESS_TTL_MS) {
			rows.delete(resId)
			return undefined
		}
		return row
	}

	return { record, read }
}
