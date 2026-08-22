import { createWriteStream } from "node:fs"
import { mkdir, readdir, rename, rm, stat } from "node:fs/promises"
import { basename, extname, join } from "node:path"
import { pipeline } from "node:stream/promises"
import type { StoragePaths } from "./paths.ts"

/**
 * Extension used for archive (zip) uploads staged in the global pool.
 * The original filename is ignored — archive uploads are always stored
 * as `<fileId>.zip` so commit / extraction can locate them by `fileId`
 * alone.
 */
const STAGED_ARCHIVE_EXT = ".zip"

/**
 * Resolve the on-disk path of a file staged in the global pool by
 * `fileId`. The pool is flat: each file is stored as `<fileId><ext>`
 * where `ext` is the lower-cased extension of the original filename
 * (or `.zip` for archive uploads). Because the extension is part of the
 * filename we scan the directory for a sibling whose stem matches
 * `fileId`.
 *
 * Returns `undefined` when no staged file matches `fileId`.
 */
export async function findStagedPoolFile(
	paths: StoragePaths,
	fileId: string,
): Promise<string | undefined> {
	const poolDir = paths.local.stagingPoolRoot()
	const names = await readdir(poolDir).catch(() => [])
	for (const name of names) {
		const ext = extname(name)
		const stem = basename(name, ext)
		if (stem === fileId) return join(poolDir, name)
	}
	return undefined
}

/**
 * Resolve multiple pool files by `fileId` with a SINGLE directory scan.
 * Committing an ordered upload resolves and then consumes every staged
 * file; the per-file {@link findStagedPoolFile} scan would cost one full
 * `readdir` per file, and the pool can hold hundreds of entries under
 * concurrent uploads. Returns a map keyed by `fileId`; ids without a
 * staged match are absent.
 */
export async function resolveStagedPoolFiles(
	paths: StoragePaths,
	fileIds: readonly string[],
): Promise<Map<string, string>> {
	const poolDir = paths.local.stagingPoolRoot()
	const names = await readdir(poolDir).catch(() => [])
	const byStem = new Map<string, string>()
	for (const name of names) {
		const ext = extname(name)
		const stem = basename(name, ext)
		if (!byStem.has(stem)) byStem.set(stem, join(poolDir, name))
	}
	const out = new Map<string, string>()
	for (const fileId of fileIds) {
		const hit = byStem.get(fileId)
		if (hit !== undefined) out.set(fileId, hit)
	}
	return out
}

/**
 * Stream a single file into the global staging pool as
 * `<fileId><ext>`. The file is first written to a `.tmp-*` sibling and
 * atomically renamed so concurrent readers (preview) never observe a
 * partial file. Returns the final staged path.
 */
export async function writeStagedPoolFile(
	paths: StoragePaths,
	fileId: string,
	filename: string,
	stream: NodeJS.ReadableStream,
): Promise<string> {
	await mkdir(paths.local.stagingPoolRoot(), { recursive: true })
	const ext = extname(filename).toLowerCase()
	const dest = paths.local.stagingPoolFile(fileId, ext)
	const tmp = `${dest}.tmp-${Date.now()}`
	try {
		await pipeline(stream, createWriteStream(tmp))
		await rename(tmp, dest)
		return dest
	} catch (err) {
		await rm(tmp, { force: true }).catch(() => {})
		throw err
	}
}

/**
 * Stream an archive (zip) upload into the global staging pool as
 * `<fileId>.zip`. Same atomic write semantics as
 * {@link writeStagedPoolFile}. Returns the final staged path.
 */
export async function writeStagedArchiveFile(
	paths: StoragePaths,
	fileId: string,
	stream: NodeJS.ReadableStream,
): Promise<string> {
	return writeStagedPoolFile(paths, fileId, "archive.zip", stream)
}

/** Resolve the staged path of an archive upload by `fileId`. */
export async function findStagedArchiveFile(
	paths: StoragePaths,
	fileId: string,
): Promise<string | undefined> {
	const existing = await findStagedPoolFile(paths, fileId)
	if (existing === undefined) return undefined
	// Archives are always stored with the `.zip` extension.
	return extname(existing).toLowerCase() === STAGED_ARCHIVE_EXT
		? existing
		: undefined
}

/**
 * Remove a single file from the global staging pool. Returns `true` when
 * a file was removed, `false` when `fileId` was not present.
 */
export async function removeStagedPoolFile(
	paths: StoragePaths,
	fileId: string,
): Promise<boolean> {
	const existing = await findStagedPoolFile(paths, fileId)
	if (existing === undefined) return false
	await rm(existing, { force: true }).catch(() => {})
	// Best-effort: the file may have been removed concurrently.
	const stillThere = await stat(existing).catch(() => undefined)
	return stillThere === undefined
}
