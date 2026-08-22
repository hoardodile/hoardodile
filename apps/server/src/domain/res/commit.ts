import { copyFile, mkdir, readdir, rename, rm, stat } from "node:fs/promises"
import { dirname, extname, join } from "node:path"
import {
	createOccupiedNames,
	findStagedArchiveFile,
	occupyEntryName,
	RESOURCE_DATA_DIR_NAME,
	resolveStagedPoolFiles,
	sanitizeEntryName,
	uniqueEntryName,
	validateArchiveBudget,
	writeOrderManifest,
	writeVersioned,
} from "@hoardodile/host/hoard"
import { invalid } from "@hoardodile/shared"
import type { MutableRef } from "src/infra/runtime-context.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"

export type CommitResult = {
	/** The resource folder that now holds the committed source entries. */
	readonly dirPath: string
}

export type CommitServiceOptions = {
	/**
	 * Hard cap on the cumulative uncompressed byte size an archive upload
	 * is allowed to contain. Defends against zip bombs whose compressed size
	 * sits below `MAX_UPLOAD_BYTES` but whose uncompressed payload could
	 * still exhaust the disk when extracted later.
	 */
	readonly maxArchiveExtractedBytes: number
}

export type CommitService = {
	/**
	 * Commit an ordered resource whose files live in the global staging
	 * pool. `fileIds` defines the final entry order; each id must resolve
	 * to a staged pool file. `names` carries the original client
	 * filenames, parallel to `fileIds`; each is sanitized before install
	 * and collisions get a `-N` suffix. On success the consumed pool
	 * files are removed; on failure they are left in place so the client
	 * can retry.
	 */
	commitOrderedByIds(
		id: string,
		fileIds: readonly string[],
		names: readonly string[] | undefined,
	): Promise<CommitResult>
	/**
	 * Commit a resource whose source is a single staged archive (zip).
	 * The archive is validated (central-directory budget) and installed
	 * as-is under the sanitized original `filename`. On success the
	 * staged archive is removed; on failure it is left in place.
	 */
	commitArchiveById(
		id: string,
		archiveFileId: string,
		filename: string,
	): Promise<CommitResult>
	/**
	 * Commit a resource whose source is a local directory tree (folder
	 * import). Files are copied into the resource folder with their
	 * relative structure preserved and every name sanitized. The source
	 * directory is left untouched.
	 */
	commitDirectoryTree(id: string, srcDir: string): Promise<CommitResult>
}

export function buildCommitService(
	paths: StoragePaths,
	options: CommitServiceOptions,
	readOnly: MutableRef<boolean>,
): CommitService {
	async function commitOrderedByIds(
		id: string,
		fileIds: readonly string[],
		names: readonly string[] | undefined,
	): Promise<CommitResult> {
		if (fileIds.length === 0) {
			throw invalid(
				"resource.upload_missing_file_order",
				"fileIds is required for ordered uploads",
			)
		}
		if (names !== undefined && names.length !== fileIds.length) {
			throw invalid(
				"resource.upload_name_mismatch",
				"names must be parallel to fileIds",
				{ fileIds: fileIds.length, names: names.length },
			)
		}
		const seen = new Set<string>()
		for (const fileId of fileIds) {
			if (seen.has(fileId)) {
				throw invalid(
					"resource.upload_duplicate_file_id",
					`fileIds contains duplicate file id: ${fileId}`,
					{ fileId },
				)
			}
			seen.add(fileId)
		}
		// One directory scan resolves every fileId — per-file lookups would
		// readdir the whole pool once per file (and again on cleanup below).
		const resolvedPaths = await resolveStagedPoolFiles(paths, fileIds)
		const resolved: { absPath: string; entryName: string }[] = []
		for (let i = 0; i < fileIds.length; i += 1) {
			const fileId = fileIds[i]!
			const absPath = resolvedPaths.get(fileId)
			if (absPath === undefined) {
				throw invalid(
					"resource.upload_missing_file",
					`file ${fileId} missing from staging pool`,
					{ fileId },
				)
			}
			const entryName =
				sanitizeEntryName(names?.[i] ?? "") ?? fallbackName(absPath)
			resolved.push({ absPath, entryName })
		}

		const dirPath = await writeVersioned(paths, readOnly.current, (current) =>
			withResourceFolderReplace(current.resource(id), async (root) => {
				const dataDir = join(root, RESOURCE_DATA_DIR_NAME)
				const uniqueNames = resolveUniqueEntryNames(
					resolved.map((entry) => entry.entryName),
				)
				const unique = resolved.map((entry, index) => ({
					...entry,
					entryName: uniqueNames[index]!,
				}))
				for (const entry of unique) {
					const dest = join(dataDir, entry.entryName)
					await mkdir(dirname(dest), { recursive: true })
					await rename(entry.absPath, dest)
				}
				// The order manifest lives inside the replaced data/ subtree,
				// so content and its sequence are swapped atomically — a
				// stale manifest can never survive a re-upload.
				await writeOrderManifest(
					dataDir,
					unique.map((e) => e.entryName),
				)
				return root
			}),
		)
		// Only remove pool files once the entries are safely installed.
		await Promise.all(
			resolved.map(
				(entry) => rm(entry.absPath, { force: true }).catch(() => {}), // write-local-only
			),
		)
		return { dirPath }
	}

	async function commitArchiveById(
		id: string,
		archiveFileId: string,
		filename: string,
	): Promise<CommitResult> {
		const incomingPath = await findStagedArchiveFile(paths, archiveFileId)
		if (incomingPath === undefined) {
			throw invalid(
				"resource.upload_missing_file",
				`archive ${archiveFileId} missing from staging pool`,
				{ fileId: archiveFileId },
			)
		}
		await validateArchiveBudget(incomingPath, options.maxArchiveExtractedBytes)
		const entryName = sanitizeEntryName(filename) ?? "archive.zip"

		const dirPath = await writeVersioned(paths, readOnly.current, (current) =>
			withResourceFolderReplace(current.resource(id), async (root) => {
				const dest = join(root, RESOURCE_DATA_DIR_NAME, entryName)
				await mkdir(dirname(dest), { recursive: true })
				await rename(incomingPath, dest)
				return root
			}),
		)
		// write-local-only: staged archive lives in local/.tmp/staging.
		await rm(incomingPath, { force: true }).catch(() => {})
		return { dirPath }
	}

	async function commitDirectoryTree(
		id: string,
		srcDir: string,
	): Promise<CommitResult> {
		const files = await walkDirectory(srcDir)
		if (files.length === 0) {
			throw invalid(
				"resource.upload_empty_archive",
				"folder contains no importable files",
			)
		}
		let totalBytes = 0
		const planned: { src: string; relName: string }[] = []
		for (const file of files) {
			totalBytes += file.size
			if (totalBytes > options.maxArchiveExtractedBytes) {
				throw invalid(
					"resource.archive_too_large",
					`folder import exceeds ${options.maxArchiveExtractedBytes} bytes`,
					{ maxBytes: options.maxArchiveExtractedBytes },
				)
			}
			const relName = sanitizeEntryName(file.rel) ?? fallbackName(file.absPath)
			planned.push({ src: file.absPath, relName })
		}
		const uniqueNames = resolveUniqueEntryNames(
			planned.map((entry) => entry.relName),
		)
		const unique = planned.map((entry, index) => ({
			...entry,
			relName: uniqueNames[index]!,
		}))

		const dirPath = await writeVersioned(paths, readOnly.current, (current) =>
			withResourceFolderReplace(current.resource(id), async (root) => {
				const dataDir = join(root, RESOURCE_DATA_DIR_NAME)
				for (const entry of unique) {
					const dest = join(dataDir, entry.relName)
					await mkdir(dirname(dest), { recursive: true })
					await copyFile(entry.src, dest)
				}
				return root
			}),
		)
		return { dirPath }
	}

	return { commitOrderedByIds, commitArchiveById, commitDirectoryTree }
}

/**
 * Build a fresh resource folder in place, rolling back to the previous
 * contents on failure. The existing folder is moved aside, its metadata
 * dotfiles (`.cover.*`, `.deleted`) are preserved, `install` writes the
 * new entries, and the aside is discarded — or restored when `install`
 * throws. All three commit paths share this one invariant.
 */
async function withResourceFolderReplace<T>(
	root: string,
	install: (root: string) => Promise<T>,
): Promise<T> {
	const asidePath = await swapFolderForReplace(root)
	try {
		await mkdir(root, { recursive: true })
		return await install(root)
	} catch (err) {
		await restoreAside(root, asidePath)
		throw err
	} finally {
		await rm(asidePath, { recursive: true, force: true }).catch(() => {})
	}
}

/**
 * Resolve batch name collisions: every name is made unique against the
 * ones before it (case-insensitive, files block ancestor prefixes too).
 */
function resolveUniqueEntryNames(names: readonly string[]): string[] {
	const occupied = createOccupiedNames()
	return names.map((name) => {
		const unique = uniqueEntryName(occupied, name)
		occupyEntryName(occupied, unique)
		return unique
	})
}

/**
 * Move the existing resource folder aside so a fresh one can be built in
 * place. Metadata dotfiles (`.cover.*`, `.deleted`) are preserved from
 * the aside; returns the aside path (empty when nothing was moved).
 */
async function swapFolderForReplace(root: string): Promise<string> {
	const info = await stat(root).catch(() => undefined)
	if (!info?.isDirectory()) return ""
	const asidePath = `${root}.replacing-${Date.now()}`
	await rename(root, asidePath)
	const metadataNames = await readdir(asidePath, { withFileTypes: true })
	await mkdir(root, { recursive: true })
	for (const entry of metadataNames) {
		if (!entry.isFile()) continue
		if (!entry.name.startsWith(".")) continue
		await rename(join(asidePath, entry.name), join(root, entry.name)).catch(
			() => {},
		)
	}
	return asidePath
}

/** Roll a failed install back to the aside (which may be empty). */
async function restoreAside(root: string, asidePath: string): Promise<void> {
	if (asidePath.length === 0) return
	await rm(root, { recursive: true, force: true }).catch(() => {})
	await rename(asidePath, root).catch(() => {})
}

/** Staged pool files are named `<fileId><ext>` — fall back to `file.ext`. */
function fallbackName(absPath: string): string {
	const ext = extname(absPath).toLowerCase()
	return ext.length > 0 ? `file${ext}` : "file"
}

type WalkedFile = {
	readonly absPath: string
	readonly rel: string
	readonly size: number
}

/** Recursively walk `dir`, yielding files with `/`-joined relative paths. */
async function walkDirectory(dir: string): Promise<readonly WalkedFile[]> {
	const out: WalkedFile[] = []
	await walkInto(dir, dir, out)
	return out
}

async function walkInto(
	root: string,
	here: string,
	out: WalkedFile[],
): Promise<void> {
	const entries = await readdir(here, { withFileTypes: true })
	for (const entry of entries) {
		if (entry.name.startsWith(".")) continue
		const absPath = join(here, entry.name)
		if (entry.isDirectory()) {
			await walkInto(root, absPath, out)
			continue
		}
		if (!entry.isFile()) continue
		const rel = join(here, entry.name)
			.slice(root.length)
			.replace(/\\/g, "/")
			.replace(/^\//, "")
		const info = await stat(absPath)
		out.push({ absPath, rel, size: info.size })
	}
}
