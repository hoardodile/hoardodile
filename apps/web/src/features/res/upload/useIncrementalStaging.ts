import { Semaphore } from "es-toolkit"
import { useEffect, useRef, useState } from "react"
import type { FileListEntry } from "./FileListEditor"
import {
	STAGING_MAX_INFLIGHT,
	stageSingleFile,
	type UploadProgress,
} from "./upload"

export type UseIncrementalStagingResult = {
	/**
	 * Ordered list of staged `fileId`s, aligned 1:1 with the current
	 * `entries`. `undefined` at a position means that file has not finished
	 * staging yet (or staging failed). Pass this list (filtered to defined
	 * values, in entry order) to `resource.create({ files })` at submit.
	 */
	readonly fileIds: readonly (string | undefined)[]
	readonly fileProgresses: readonly number[]
	readonly isStaging: boolean
	readonly stagingComplete: boolean
}

export type UseIncrementalStagingOptions = {
	/** Debounce before starting a stage. Defaults to 300 ms. */
	readonly debounceMs?: number
}

/**
 * Manage per-file staging of ordered uploads against the global staging
 * pool.
 *
 * Each entry is staged independently via `POST /api/uploads/ordered`; the
 * server returns a `fileId` that is kept in a `Map<entryId, fileId>`. When
 * the user adds files, only the new ones are uploaded. When the user
 * removes a file, its local `fileId` reference is dropped but the staged
 * bytes are left on the server; the application startup sequence cleans
 * the staging pool once. Reordering is purely client-side (no bytes move).
 * Already-staged files are never re-uploaded.
 *
 * Uploads launch under a {@link STAGING_MAX_INFLIGHT} semaphore so a large
 * batch never saturates the browser's per-host connection pool — a
 * finished file's preview fetch needs a free socket, and per-file previews
 * are what the strip shows while the rest of the batch is still uploading.
 *
 * On unmount, in-flight uploads are aborted. When an entry is removed
 * mid-upload, only the local reference is dropped; the XHR is left to
 * finish or fail on its own and any late resolution is ignored once the
 * id leaves the known-ids set. This avoids surfacing a network error when
 * the server has already staged the file.
 *
 * Upload status is binary from the consumer's point of view: `isStaging`
 * means at least one upload is still in flight (submit stays gated), and it
 * clears once every in-flight upload settles — success or failure. A failed
 * or timed-out entry is reported with progress `-1` (never as "in progress"),
 * and `stagingComplete` stays false until every entry is staged.
 */
export function useIncrementalStaging(
	entries: readonly FileListEntry[],
	options: UseIncrementalStagingOptions = {},
): UseIncrementalStagingResult {
	const debounceMs = options.debounceMs ?? 300

	const [fileIds, setFileIds] = useState<(string | undefined)[]>([])
	const [fileProgresses, setFileProgresses] = useState<number[]>([])
	const [isStaging, setIsStaging] = useState(false)
	const [stagingComplete, setStagingComplete] = useState(false)

	// entryId -> server fileId for files that have been successfully staged.
	const stagedMapRef = useRef<Map<string, string>>(new Map())
	// entryId -> current upload progress (0..1), for live UI updates.
	const progressMapRef = useRef<Map<string, number>>(new Map())
	// entryId -> AbortController for any in-flight upload.
	const inflightRef = useRef<Map<string, AbortController>>(new Map())
	// The set of entryIds we have ever seen, so we can detect removals even
	// when an upload is still in flight. Doubles as the liveness check for
	// late upload resolutions: an id only leaves this set when its entry
	// was removed, so adding files mid-upload never invalidates results.
	const knownIdsRef = useRef<Set<string>>(new Set())
	// Latest entries snapshot, for async resolutions that may outlive the
	// effect run that launched them.
	const entriesRef = useRef<readonly FileListEntry[]>([])

	useEffect(() => {
		entriesRef.current = entries

		const currentIds = new Set(entries.map((e) => e.id))
		const previousIds = knownIdsRef.current

		// Detect removed entries: drop their local references. Any in-flight
		// upload is left to finish or fail on its own; its resolution will be
		// ignored once the id leaves the known set. The staged bytes are left
		// on the server and reclaimed at the next application startup.
		const removedIds: string[] = []
		for (const id of previousIds) {
			if (!currentIds.has(id)) removedIds.push(id)
		}
		for (const id of removedIds) {
			knownIdsRef.current.delete(id)
			inflightRef.current.delete(id)
			progressMapRef.current.delete(id)
			stagedMapRef.current.delete(id)
		}

		// Detect added entries: stage them. Also detect entries whose `file`
		// changed (same id, different File) by comparing identity — treat
		// those as remove+add.
		const toStage: { entry: FileListEntry; replace: string | undefined }[] = []
		for (const entry of entries) {
			const known = stagedMapRef.current.get(entry.id)
			const inflight = inflightRef.current.has(entry.id)
			if (known !== undefined || inflight) {
				// Already staged or staging. (File-identity drift is not
				// tracked here because FileListEditor mints a fresh id when
				// the user swaps a file.)
				continue
			}
			toStage.push({ entry, replace: undefined })
		}

		// Recompute the aligned output arrays from the current entries.
		// A progress of -1 marks an entry whose upload failed or timed out:
		// the tile hides its progress bar and shows a failure badge instead,
		// and the aggregate strip treats it as settled (never "in progress").
		const recompute = () => {
			const ids = entriesRef.current.map((e) => stagedMapRef.current.get(e.id))
			const progresses = entriesRef.current.map(
				(e) =>
					progressMapRef.current.get(e.id) ??
					(stagedMapRef.current.has(e.id) ? 1 : 0),
			)
			setFileIds(ids)
			setFileProgresses(progresses)
		}

		// Refresh the aligned arrays and clear the busy gates once nothing
		// remains in flight. "Completed" requires every entry staged; "in
		// progress" clears as soon as no upload remains in flight — a settled
		// failure must not keep the gate locked.
		const settle = () => {
			recompute()
			if (inflightRef.current.size === 0) {
				setIsStaging(false)
				if (entriesRef.current.every((e) => stagedMapRef.current.has(e.id))) {
					setStagingComplete(true)
				}
			}
		}

		// Upload one entry. Results are adopted only while the entry is still
		// part of the list (known-ids check), so appending files mid-upload
		// never discards in-flight results the way a run token would.
		const stageEntry = async (entry: FileListEntry): Promise<void> => {
			const ctrl = new AbortController()
			inflightRef.current.set(entry.id, ctrl)
			try {
				const result = await stageSingleFile({
					file: entry.file,
					signal: ctrl.signal,
					onProgress: (p) => {
						progressMapRef.current.set(
							entry.id,
							p.total > 0 ? p.loaded / p.total : 0,
						)
						setFileProgresses((prev) => {
							const idx = entriesRef.current.findIndex((e) => e.id === entry.id)
							if (idx < 0) return prev
							const next = [...prev]
							while (next.length <= idx) next.push(0)
							next[idx] = p.total > 0 ? p.loaded / p.total : 0
							return next
						})
					},
				})
				if (!knownIdsRef.current.has(entry.id)) {
					inflightRef.current.delete(entry.id)
					return
				}
				stagedMapRef.current.set(entry.id, result.fileId)
				progressMapRef.current.set(entry.id, 1)
				inflightRef.current.delete(entry.id)
				settle()
			} catch (err) {
				inflightRef.current.delete(entry.id)
				if (err instanceof Error && err.message === "aborted") return
				if (!knownIdsRef.current.has(entry.id)) return
				// Mark the entry as failed so its tile stops looking
				// like an upload in progress. stagingComplete stays
				// false; once no upload remains in flight the submit
				// gate unlocks — a settled failure is not "uploading".
				progressMapRef.current.set(entry.id, -1)
				console.warn("Per-file staging failed:", err)
				settle()
			}
		}

		if (toStage.length === 0) {
			recompute()
			const done = entriesRef.current.every((e) =>
				stagedMapRef.current.has(e.id),
			)
			setIsStaging(false)
			setStagingComplete(done && entriesRef.current.length > 0)
			knownIdsRef.current = currentIds
			return
		}

		setIsStaging(true)
		setStagingComplete(false)
		for (const { entry } of toStage) {
			knownIdsRef.current.add(entry.id)
		}
		recompute()

		const timer = setTimeout(() => {
			// Launched under a semaphore: the browser caps HTTP/1.1 at ~6
			// connections per host, and keeping headroom means a finished
			// file's preview fetch is not queued behind the rest of the batch.
			const gate = new Semaphore(STAGING_MAX_INFLIGHT)
			for (const { entry } of toStage) {
				void gate.acquire().then(async () => {
					try {
						await stageEntry(entry)
					} finally {
						gate.release()
					}
				})
			}
		}, debounceMs)

		return () => {
			clearTimeout(timer)
			// Removal no longer aborts in-flight uploads; the cleanup only
			// cancels the debounce timer.
		}
	}, [entries, debounceMs])

	// On unmount, abort in-flight uploads. Staged files are left in the
	// server-side pool and reclaimed at the next application startup.
	useEffect(() => {
		return () => {
			for (const ctrl of inflightRef.current.values()) ctrl.abort()
			inflightRef.current.clear()
			stagedMapRef.current.clear()
			progressMapRef.current.clear()
			knownIdsRef.current.clear()
		}
	}, [])

	return {
		fileIds,
		fileProgresses,
		isStaging,
		stagingComplete,
	}
}

export type { UploadProgress }
