import { createWriteStream, type Dirent } from "node:fs"
import { mkdir, readdir, rename, rm, unlink } from "node:fs/promises"
import { dirname, join } from "node:path"
import { Readable } from "node:stream"
import { pipeline } from "node:stream/promises"
import {
	archiveStaleFiles,
	buildVersionedFolderOps,
	writeVersioned,
} from "@hoardodile/host/hoard"
import { IMAGE_EXTS } from "@hoardodile/sdk-types/media-exts"
import { conflict, invalid } from "@hoardodile/shared"
import { resources } from "src/domain/res/schema.ts"
import type { SqliteDb } from "src/infra/db/connection.ts"
import { atomicWriteJsonSync, readJsonFile } from "src/infra/json-sidecar.ts"
import type { MutableRef } from "src/infra/runtime-context.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"

const FILES_CACHE_VERSION = 2
/** Memory bound for the findCover directory cache (one entry per resource). */
const COVER_DIR_CACHE_MAX = 10_000

type CacheShape<T = unknown> = {
	readonly v: typeof FILES_CACHE_VERSION
	readonly payload: T
}

/**
 * Pure file-system layer for the resource module. No database access;
 * no domain logic. The service layer calls these functions alongside
 * repository calls to coordinate disk and DB state.
 *
 * **Versioning**: resource source artifacts are immutable after
 * creation, so reads always operate on
 * `paths.atVersion(row.fileVersion).X(id)`. Writes target the **current**
 * (latest writable) version. Source writes are forbidden once
 * `fileVersion < latestVersion` (the past archive must stay immutable)
 * and surfaces as a `resource.frozen_archive` domain conflict.
 * Covers are mutable and tracked by `coverVersion` independently.
 *
 * Source bytes themselves are owned by the upload pipeline (commit
 * writes bare files under `paths.latest.resource(id)`); this module
 * only handles the cover and the derived-artifact / lifecycle surface.
 */
export type ResFiles = {
	/** Ensure the current-version resource folder exists. */
	ensureFolder(id: string): Promise<void>
	/** Remove the current-version resource folder. Swallows missing-path errors. */
	removeFolder(id: string): Promise<void>
	/**
	 * When source bytes live only under frozen past archives (`fileVersion <
	 * latestVersion`), hard-delete cannot remove those folders; drop a
	 * `.deleted` placeholder in the **current** version folder instead.
	 * When `fileVersion === latestVersion`, hard-delete moves the live
	 * folder to `local/trash/` instead.
	 */
	markDeleted(id: string): Promise<string>
	/**
	 * Move `paths.latest.resource(id)` into `local/trash/` with a unique
	 * directory name. No-op when the source path is missing (same as a
	 * removed folder). Returns the destination path (whether or not a move
	 * occurred).
	 */
	moveFolderToTrash(id: string): Promise<string>
	findCover(id: string, version: number): Promise<string | undefined>
	/**
	 * Atomically write a cover for a resource. Only allowed when the
	 * caller-supplied version equals `paths.latestVersion`.
	 *
	 * @throws DomainError `resource.invalid_cover_ext` for bad extensions.
	 * @throws DomainError `resource.frozen_archive` when version is past.
	 */
	writeCover(
		id: string,
		version: number,
		ext: string,
		data: Buffer,
	): Promise<string>
	deleteCover(id: string, version: number): Promise<void>
	/** Remove local cover files and the per-file display cache for a resource. */
	clearLocalDerivatives(id: string): Promise<void>
	/**
	 * Remove only the rendered cover variants for a resource, keeping the
	 * file-list cache, extracted entries and per-file previews. Used by
	 * cover replace/clear — the archive entries the cache describes do not
	 * change with the cover.
	 */
	clearCoverDerivatives(id: string): Promise<void>
	/**
	 * Read the sidecar `files-cache.json` for a resource. Returns
	 * `undefined` when the file is missing, malformed, or written by a
	 * different cache schema version — callers should fall back to
	 * regenerating the list and writing back via {@link writeFilesCache}.
	 */
	readFilesCache<T = unknown>(id: string): Promise<T | undefined>
	/**
	 * Write the sidecar cache. Resource source artifacts are immutable
	 * (archived) after upload, so the cache never needs explicit
	 * invalidation under normal operation; replace/upload paths already
	 * route through `clearLocalDerivatives` which removes this file.
	 */
	writeFilesCache<T = unknown>(id: string, payload: T): Promise<void>
}

export function buildResourceFiles(
	paths: StoragePaths,
	readOnly: MutableRef<boolean>,
): ResFiles {
	// Directory-listing cache for findCover, keyed by `${version}:${id}`.
	// Every folder-mutating operation on this module invalidates the
	// resource's keys (a missing folder is cached too), so the hot cover
	// route stops paying one readdir per request.
	const coverDirCache = new Map<string, readonly Dirent[] | undefined>()

	function invalidateCoverDir(id: string): void {
		for (const key of coverDirCache.keys()) {
			if (key.endsWith(`:${id}`)) coverDirCache.delete(key)
		}
	}

	function assertWritable(fileVersion: number): void {
		if (fileVersion !== paths.latestVersion) {
			throw conflict(
				"resource.frozen_archive",
				`resource at archive version ${fileVersion} is read-only (current ${paths.latestVersion})`,
				{ fileVersion, latestVersion: paths.latestVersion },
			)
		}
	}

	const folderOps = buildVersionedFolderOps(paths, readOnly, "resource")

	async function ensureFolder(id: string): Promise<void> {
		await folderOps.ensureFolder(id)
		invalidateCoverDir(id)
	}

	async function removeFolder(id: string): Promise<void> {
		invalidateCoverDir(id)
		await folderOps.removeFolder(id)
	}

	async function markDeleted(id: string): Promise<string> {
		invalidateCoverDir(id)
		return folderOps.markDeleted(id)
	}

	async function moveFolderToTrash(id: string): Promise<string> {
		invalidateCoverDir(id)
		return folderOps.moveFolderToTrash(id)
	}

	async function findCover(
		id: string,
		version: number,
	): Promise<string | undefined> {
		const key = `${version}:${id}`
		if (!coverDirCache.has(key)) {
			let entries: readonly Dirent[] | undefined
			try {
				entries = await readdir(paths.atVersion(version).resource(id), {
					withFileTypes: true,
				})
			} catch {
				entries = undefined
			}
			coverDirCache.set(key, entries)
			if (coverDirCache.size > COVER_DIR_CACHE_MAX) {
				const oldest = coverDirCache.keys().next().value
				if (oldest !== undefined) coverDirCache.delete(oldest)
			}
		}
		const cached = coverDirCache.get(key)
		const match = (cached ?? []).find(
			(e) => e.isFile() && /^\.cover\./i.test(e.name),
		)
		return match !== undefined
			? join(paths.atVersion(version).resource(id), match.name)
			: undefined
	}

	async function writeCover(
		id: string,
		version: number,
		ext: string,
		data: Buffer,
	): Promise<string> {
		assertWritable(version)
		invalidateCoverDir(id)
		return writeVersioned(paths, readOnly.current, async (current) => {
			const normalized = ext.toLowerCase()
			if (!/^\.[a-z0-9]+$/i.test(normalized) || !IMAGE_EXTS.has(normalized)) {
				throw invalid(
					"resource.invalid_cover_ext",
					`invalid cover extension: ${ext}`,
					{ ext },
				)
			}
			const root = current.resource(id)
			await mkdir(root, { recursive: true })

			// Archive any previous cover(s) to `local/` before writing the new one.
			await archiveStaleFiles({
				sourceFolder: root,
				destFolder: paths.local.resource(id),
				match: (name) => /^\.cover\./i.test(name),
				archivePrefix: ".cover_",
			})

			const dest = join(root, `.cover${normalized}`)
			const tmp = `${dest}.writing-${process.pid}-${Date.now()}`
			try {
				await pipeline(Readable.from(data), createWriteStream(tmp))
				await rename(tmp, dest) // write-local-only // write-local-only
			} catch (err) {
				await rm(tmp, { force: true }).catch(() => {}) // write-local-only // write-local-only
				throw err
			}
			return dest
		})
	}

	async function deleteCover(id: string, version: number): Promise<void> {
		assertWritable(version)
		invalidateCoverDir(id)
		await writeVersioned(paths, readOnly.current, async (current) => {
			try {
				const root = current.resource(id)
				const entries = await readdir(root, { withFileTypes: true })
				await Promise.all(
					entries
						.filter((e) => e.isFile() && /^\.cover\./i.test(e.name))
						.map((e) => unlink(join(root, e.name)).catch(() => {})),
				)
			} catch {
				// folder doesn't exist; nothing to do
			}
		})
	}

	async function clearLocalDerivatives(id: string): Promise<void> {
		const dir = paths.local.resource(id)
		// write-local-only: derived caches live under local/, not versions/.
		await clearCoverVariants(dir)
		await unlink(paths.local.resFilesCache(id)).catch(() => {})
	}

	async function clearCoverDerivatives(id: string): Promise<void> {
		// Only the rendered cover thumbs depend on the cover itself.
		await clearCoverVariants(paths.local.resource(id), {
			includeFileCaches: false,
		})
	}

	async function readFilesCache<T>(id: string): Promise<T | undefined> {
		const raw = readJsonFile(paths.local.resFilesCache(id)) as
			| Partial<CacheShape<T>>
			| undefined
		if (raw?.v !== FILES_CACHE_VERSION || raw.payload === undefined) {
			return undefined
		}
		return raw.payload
	}

	async function writeFilesCache<T>(id: string, payload: T): Promise<void> {
		const dest = paths.local.resFilesCache(id)
		await mkdir(dirname(dest), { recursive: true }) // write-local-only
		// write-local-only: sidecar cache lives under local/, not versions/.
		atomicWriteJsonSync(dest, {
			v: FILES_CACHE_VERSION,
			payload,
		} satisfies CacheShape<T>)
	}

	return {
		ensureFolder,
		removeFolder,
		markDeleted,
		moveFolderToTrash,
		findCover,
		writeCover,
		deleteCover,
		clearLocalDerivatives,
		clearCoverDerivatives,
		readFilesCache,
		writeFilesCache,
	}
}

/**
 * Remove every cover derivative inside `dir` while leaving any
 * non-derived siblings (`.cover_*`, archived character variants) intact.
 * The derivative set is: top-level `*.webp` / `*.avif` variant files,
 * plus — unless `includeFileCaches` is false — the `file-preview/`
 * per-file preview cache and the `extracted/` materialized-entry cache.
 * Idempotent; missing entries are silently ignored.
 */
// write-local-only: `dir` is always a local/ path.
export async function clearCoverVariants(
	dir: string,
	opts: { readonly includeFileCaches?: boolean } = {},
): Promise<void> {
	const includeFileCaches = opts.includeFileCaches ?? true
	const entries = await readdir(dir).catch(() => [])
	await Promise.all(
		// write-local-only
		entries.map(async (entry) => {
			if (entry.endsWith(".webp") || entry.endsWith(".avif")) {
				await unlink(join(dir, entry)).catch(() => {}) // write-local-only
				return
			}
			if (includeFileCaches && entry === "file-preview") {
				// write-local-only
				await rm(join(dir, entry), {
					recursive: true,
					force: true,
				}).catch(() => {})
			}
			if (includeFileCaches && entry === "extracted") {
				// write-local-only
				await rm(join(dir, entry), {
					recursive: true,
					force: true,
				}).catch(() => {})
			}
		}),
	)
}

/**
 * Boot-time sweep that removes local derived resource folders on disk whose
 * ids no longer exist in the database. This reclaims space left behind when
 * `moveFolderToTrash` failed due to transient file locks (EPERM/EBUSY).
 *
 * Versioned resource folders are intentionally NOT swept: after a backup restore
 * or version switch the active database may not reference every resource that
 * still exists on disk in another version, and deleting those folders would
 * be data loss.
 */
export async function cleanupOrphanResourceFolders(
	paths: StoragePaths,
	db: SqliteDb,
): Promise<void> {
	const rows = db.select({ id: resources.id }).from(resources).all()
	const alive = new Set(rows.map((r) => r.id))

	async function sweep(dir: string): Promise<void> {
		const entries = await readdir(dir, { withFileTypes: true }).catch(
			() => [] as never[],
		)
		for (const entry of entries) {
			if (!entry.isDirectory()) continue
			if (entry.name.startsWith(".")) continue
			if (alive.has(entry.name)) continue
			// write-local-only
			await rm(join(dir, entry.name), { recursive: true, force: true }).catch(
				// write-local-only
				() => {},
			)
		}
	}

	// write-local-only: orphan sweep only touches local/ derived folders.
	const localResRoot = dirname(paths.local.resource("x"))
	await sweep(localResRoot).catch(() => {})
}
