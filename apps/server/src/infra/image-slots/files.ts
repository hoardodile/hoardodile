import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import {
	archiveStaleFiles,
	buildVersionedFolderOps,
	type VersionedFolderSubjectKind,
	writeVersioned,
} from "@hoardodile/host/hoard"
import type { MutableRef } from "src/infra/runtime-context.ts"
import type { StoragePaths, VersionPaths } from "src/infra/storage/paths.ts"

/**
 * Pure file-system layer for one "image slot" of a versioned subject
 * (character avatar/fullbody, tag art). No database access; no domain
 * logic. The service layer calls these functions alongside repository
 * calls to coordinate disk and DB state.
 *
 * All writes target the **current** (latest) archive version
 * (`paths.latest`). Reads accept a `version` argument so callers can
 * resolve a slot against the archive recorded on the row (e.g. the
 * `avatarVersion` pointer of a character, or `imageVersion` of a tag).
 */
export type ImageSlotFiles = {
	/** Ensure the current-version subject folder exists. */
	ensureFolder(id: string): Promise<void>
	/** Remove the current-version subject folder. Swallows missing-path errors. */
	removeFolder(id: string): Promise<void>
	/**
	 * When slot bytes live only under frozen past archives (all versions
	 * `< latestVersion`), hard-delete cannot alter those folders; drop a
	 * `.deleted` placeholder in the **current** folder instead.
	 * Otherwise hard-delete moves the live folder to `local/trash/`.
	 */
	markDeleted(id: string): Promise<string>
	/** Move `paths.latest.<kind>(id)` into `local/trash/` with a unique
	 * directory name. No-op when the source path is missing. */
	moveFolderToTrash(id: string): Promise<string>
	/**
	 * Locate the on-disk slot file (`<slot>.<ext>`) in `version`'s folder.
	 * Returns the absolute path or `undefined` when missing.
	 */
	findSlotInVersion(
		id: string,
		version: number,
		slot: string,
	): Promise<string | undefined>
	/**
	 * Atomically install a new slot image under the current version. Any
	 * existing `<slot>.*` files are archived to the subject's local
	 * directory before the source file is copied into place.
	 *
	 * @param sourcePath Absolute path of the validated source file (usually
	 *   a temp file under `local/cache/tmp`).
	 * @returns Absolute path of the written file.
	 */
	writeSlot(
		id: string,
		slot: string,
		ext: string,
		sourcePath: string,
	): Promise<string>
	/**
	 * Remove the slot image under the current version by archiving any
	 * existing `<slot>.*` files to the subject's local directory.
	 * Idempotent; missing files are ignored.
	 */
	removeSlot(id: string, slot: string): Promise<void>
}

/** Versioned folder of one subject kind, resolved against a version. */
type SubjectVersionFolder = (current: VersionPaths, id: string) => string

const SUBJECT_VERSION_FOLDER: Record<
	VersionedFolderSubjectKind,
	SubjectVersionFolder
> = {
	resource: (current, id) => current.resource(id),
	character: (current, id) => current.character(id),
	tag: (current, id) => current.tag(id),
}

export function buildImageSlotFiles(opts: {
	readonly paths: StoragePaths
	readonly readOnly: MutableRef<boolean>
	readonly subjectKind: VersionedFolderSubjectKind
}): ImageSlotFiles {
	const { paths, readOnly, subjectKind } = opts
	const folderOps = buildVersionedFolderOps(paths, readOnly, subjectKind)
	const folderOf = SUBJECT_VERSION_FOLDER[subjectKind]
	// Replaced slot bytes (and per-file thumbnails) land in the subject's
	// local cache directory, which mirrors the folder naming.
	const localFolderOf = (id: string): string => {
		switch (subjectKind) {
			case "resource":
				return paths.local.resource(id)
			case "character":
				return paths.local.character(id)
			case "tag":
				return paths.local.tag(id)
		}
	}

	async function findSlotInVersion(
		id: string,
		version: number,
		slot: string,
	): Promise<string | undefined> {
		const folder = folderOf(paths.atVersion(version), id)
		try {
			const entries = await readdir(folder, { withFileTypes: true })
			const match = entries.find(
				(e) => e.isFile() && e.name.startsWith(`${slot}.`),
			)
			return match !== undefined ? join(folder, match.name) : undefined
		} catch {
			return undefined
		}
	}

	async function writeSlot(
		id: string,
		slot: string,
		ext: string,
		sourcePath: string,
	): Promise<string> {
		return writeVersioned(paths, readOnly.current, async (current) => {
			const root = folderOf(current, id)
			await mkdir(root, { recursive: true })
			await archiveStaleFiles({
				sourceFolder: root,
				destFolder: localFolderOf(id),
				match: (name) => name.startsWith(`${slot}.`),
				archivePrefix: `${slot}_`,
			})
			const finalFilename = `${slot}${ext}`
			const finalPath = join(root, finalFilename)
			const tmpPath = join(root, `.uploading-${slot}-${Date.now()}${ext}`)
			try {
				await copyFile(sourcePath, tmpPath)
				await rename(tmpPath, finalPath)
			} catch (err) {
				await rm(tmpPath, { force: true }).catch(() => {})
				throw err
			}
			return finalPath
		})
	}

	async function removeSlot(id: string, slot: string): Promise<void> {
		return writeVersioned(paths, readOnly.current, async (current) => {
			const root = folderOf(current, id)
			await archiveStaleFiles({
				sourceFolder: root,
				destFolder: localFolderOf(id),
				match: (name) => name.startsWith(`${slot}.`),
				archivePrefix: `${slot}_`,
			})
		})
	}

	return {
		ensureFolder: folderOps.ensureFolder,
		removeFolder: folderOps.removeFolder,
		markDeleted: folderOps.markDeleted,
		moveFolderToTrash: folderOps.moveFolderToTrash,
		findSlotInVersion,
		writeSlot,
		removeSlot,
	}
}
