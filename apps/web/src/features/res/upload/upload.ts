import { HttpError } from "@/lib/http"
import { apiPaths } from "@/lib/paths"

/**
 * A staged upload that stops making progress for this long (no `progress`
 * events) is considered hung and fails with a timeout. Large files that
 * keep streaming are never cut off — only stalled transfers settle.
 */
export const STAGE_INACTIVITY_TIMEOUT_MS = 60_000

/**
 * Max simultaneous staged uploads. Browsers cap HTTP/1.1 at ~6
 * connections per host (dev proxies `/api` to the same origin, so the
 * uploads share that pool); keeping headroom means a finished file's
 * preview fetch is never queued behind the rest of the batch.
 */
export const STAGING_MAX_INFLIGHT = 4

export type UploadProgress = {
	readonly loaded: number
	readonly total: number
}

/**
 * Result of staging a single file via the per-file upload endpoint. The
 * returned `fileId` is later referenced in the ordered `files` list passed
 * to `resource.create({ files })`. Staged files live in a global pool and
 * and are reclaimed at the next application startup; individual deletes are no
 * longer issued by the upload UI.
 */
export type StageSingleFileResult = {
	readonly fileId: string
}

/**
 * Result of staging a single archive (zip) via the archive upload
 * endpoint. The returned `fileId` is later passed to
 * `resource.create({ archiveFileId })` (to commit the zip directly) or to
 * `resource.extractArchive({ archiveFileId })` (to extract it for the
 * folder-import flow).
 */
export type StageArchiveResult = {
	readonly fileId: string
}

export type StageSingleFileOptions = {
	readonly file: File
	readonly signal?: AbortSignal
	readonly onProgress?: (p: UploadProgress) => void
}

export type StageArchiveOptions = {
	readonly archive: File
	readonly signal?: AbortSignal
	readonly onProgress?: (p: UploadProgress) => void
}

/**
 * Stage a single file via `POST /api/uploads/ordered`. The server mints a
 * `fileId` (UUID) and returns it; the file lives in the global staging
 * pool until either committed (via `resource.create({ files: [fileId, …] })`)
 * or reclaimed at the next application startup. Reordering, adding, or removing
 * files never re-uploads bytes that have already been staged.
 *
 * Uses `XMLHttpRequest` for upload `progress` events (Chromium still does
 * not emit them on `fetch` upload bodies, and the UX needs progress for
 * multi-GB resources). A transfer that stalls for
 * {@link STAGE_INACTIVITY_TIMEOUT_MS} is aborted and rejected as a timeout
 * (a distinct error from the "aborted" signal used by callers on unmount).
 */
export function stageSingleFile(
	opts: StageSingleFileOptions,
): Promise<StageSingleFileResult> {
	if (opts.file.size === 0) {
		return Promise.reject(new Error("file is empty"))
	}
	return new Promise<StageSingleFileResult>((resolve, reject) => {
		const url = apiPaths.uploads.ordered()
		const xhr = new XMLHttpRequest()
		xhr.open("POST", url, true)
		xhr.withCredentials = true
		const fd = new FormData()
		fd.append("file", opts.file, opts.file.name)

		let settled = false
		let inactivityTimer: ReturnType<typeof setTimeout> | undefined
		const armInactivityTimer = () => {
			if (inactivityTimer !== undefined) clearTimeout(inactivityTimer)
			inactivityTimer = setTimeout(() => {
				// Settle as a timeout first (the abort event fires
				// synchronously and would otherwise claim the settlement),
				// then free the socket. "upload timed out" is distinct from
				// "aborted", which callers treat as an unmount cancel.
				finish(new Error("upload timed out"))
				xhr.abort()
			}, STAGE_INACTIVITY_TIMEOUT_MS)
		}
		const finish = (value: StageSingleFileResult | Error) => {
			if (settled) return
			settled = true
			if (inactivityTimer !== undefined) clearTimeout(inactivityTimer)
			if (value instanceof Error) reject(value)
			else resolve(value)
		}

		xhr.upload.addEventListener("progress", (ev) => {
			if (ev.lengthComputable) {
				armInactivityTimer()
				opts.onProgress?.({ loaded: ev.loaded, total: ev.total })
			}
		})
		xhr.addEventListener("load", () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				const parsed = parseFileIdResult(xhr.responseText)
				if (parsed !== undefined) {
					finish(parsed)
					return
				}
				finish(new Error("invalid upload response"))
				return
			}
			finish(httpErrorFromXhr(xhr))
		})
		xhr.addEventListener("error", () => {
			finish(new HttpError(0, "network error"))
		})
		xhr.addEventListener("abort", () => {
			finish(new HttpError(0, "aborted"))
		})
		if (opts.signal) {
			if (opts.signal.aborted) {
				xhr.abort()
				return
			}
			opts.signal.addEventListener("abort", () => xhr.abort(), { once: true })
		}
		armInactivityTimer()
		xhr.send(fd)
	})
}

/**
 * Stage a single archive (zip) via `POST /api/uploads/archive`. The server
 * mints a `fileId` (UUID) and returns it; the archive lives in the global
 * staging pool as `<fileId>.zip` until committed
 * (`resource.create({ archiveFileId })`) or extracted
 * (`resource.extractArchive({ archiveFileId })`).
 *
 * Uses `XMLHttpRequest` for upload `progress` events (same reason as
 * {@link stageSingleFile}).
 */
export function stageArchive(
	opts: StageArchiveOptions,
): Promise<StageArchiveResult> {
	if (opts.archive.size === 0) {
		return Promise.reject(new Error("archive is empty"))
	}
	return new Promise<StageArchiveResult>((resolve, reject) => {
		const url = apiPaths.uploads.archive()
		const xhr = new XMLHttpRequest()
		xhr.open("POST", url, true)
		xhr.withCredentials = true
		const fd = new FormData()
		fd.append("archive", opts.archive, opts.archive.name)

		if (opts.onProgress) {
			xhr.upload.addEventListener("progress", (ev) => {
				if (ev.lengthComputable) {
					opts.onProgress?.({ loaded: ev.loaded, total: ev.total })
				}
			})
		}
		xhr.addEventListener("load", () => {
			if (xhr.status >= 200 && xhr.status < 300) {
				const parsed = parseFileIdResult(xhr.responseText)
				if (parsed !== undefined) {
					resolve(parsed)
					return
				}
				reject(new Error("invalid upload response"))
				return
			}
			reject(httpErrorFromXhr(xhr))
		})
		xhr.addEventListener("error", () => {
			reject(new HttpError(0, "network error"))
		})
		xhr.addEventListener("abort", () => {
			reject(new HttpError(0, "aborted"))
		})
		if (opts.signal) {
			if (opts.signal.aborted) {
				xhr.abort()
				return
			}
			opts.signal.addEventListener("abort", () => xhr.abort(), { once: true })
		}
		xhr.send(fd)
	})
}

function parseFileIdResult(raw: string): StageSingleFileResult | undefined {
	try {
		const body: unknown = JSON.parse(raw || "{}")
		if (body === null || typeof body !== "object") return undefined
		if (
			"fileId" in body &&
			typeof body.fileId === "string" &&
			body.fileId.length > 0
		) {
			return { fileId: body.fileId }
		}
		return undefined
	} catch {
		return undefined
	}
}

function httpErrorFromXhr(xhr: XMLHttpRequest): HttpError {
	let message = xhr.statusText || "upload failed"
	try {
		const body: unknown = JSON.parse(xhr.responseText || "{}")
		if (
			body !== null &&
			typeof body === "object" &&
			"error" in body &&
			typeof body.error === "string"
		) {
			message = body.error
		}
	} catch {
		/* keep default */
	}
	return new HttpError(xhr.status, message)
}
