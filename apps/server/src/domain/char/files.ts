import { copyFile, mkdir, readdir, rename, rm } from "node:fs/promises"
import { join } from "node:path"
import {
	archiveStaleFiles,
	buildVersionedFolderOps,
	writeVersioned,
} from "@hoardodile/host/hoard"
import type { MutableRef } from "src/infra/runtime-context.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"

/**
 * Pure file-system layer for the character module. No database access;
 * no domain logic. The service layer calls these functions alongside
 * repository calls to coordinate disk and DB state.
 *
 * All writes target the **current** (latest) archive version
 * (`paths.latest.character(id)`). Reads accept a `version` argument so
 * callers can resolve avatar/fullbody against the archive recorded on
 * the row (`avatarVersion` / `fullbodyVersion` columns).
 */
export type CharFiles = {
	ensureFolder(id: string): Promise<void>
	/** Remove the current-version character folder. Swallows missing-path errors. */
	removeFolder(id: string): Promise<void>
	/**
	 * When avatar/fullbody bytes live only under frozen past archives (both
	 * versions `< latestVersion`), hard-delete cannot alter those folders;
	 * drop a `.deleted` placeholder in the **current** folder instead.
	 * Otherwise hard-delete moves the live folder to `local/trash/`.
	 */
	markDeleted(id: string): Promise<string>
	/**
	 * Move `paths.latest.character(id)` into `local/trash/` with a unique
	 * directory name. No-op when the source path is missing.
	 */
	moveFolderToTrash(id: string): Promise<string>
	/**
	 * Locate the on-disk avatar / fullbody file in `version`'s folder.
	 * Returns absolute path or `undefined` when missing.
	 */
	findVariantInVersion(
		id: string,
		version: number,
		variant: "avatar" | "fullbody",
	): Promise<string | undefined>
	/**
	 * Atomically install a new avatar/fullbody image under the current
	 * version. Any existing `<variant>.*` files are archived to the local
	 * character directory before the source file is copied into place.
	 *
	 * @param sourcePath Absolute path of the validated source file (usually
	 *   a temp file under `local/cache/tmp`).
	 * @returns Absolute path of the written file.
	 */
	writeVariant(
		id: string,
		variant: "avatar" | "fullbody",
		ext: string,
		sourcePath: string,
	): Promise<string>
	/**
	 * Remove the avatar/fullbody image under the current version by
	 * archiving any existing `<variant>.*` files to the local character
	 * directory. Idempotent; missing files are ignored.
	 */
	deleteVariant(id: string, variant: "avatar" | "fullbody"): Promise<void>
}

export function buildCharacterFiles(
	paths: StoragePaths,
	readOnly: MutableRef<boolean>,
): CharFiles {
	const folderOps = buildVersionedFolderOps(paths, readOnly, "character")

	async function findVariantInVersion(
		id: string,
		version: number,
		variant: "avatar" | "fullbody",
	): Promise<string | undefined> {
		const folder = paths.atVersion(version).character(id)
		try {
			const entries = await readdir(folder, { withFileTypes: true })
			const match = entries.find(
				(e) => e.isFile() && e.name.startsWith(`${variant}.`),
			)
			return match !== undefined ? join(folder, match.name) : undefined
		} catch {
			return undefined
		}
	}

	async function writeVariant(
		id: string,
		variant: "avatar" | "fullbody",
		ext: string,
		sourcePath: string,
	): Promise<string> {
		return writeVersioned(paths, readOnly.current, async (current) => {
			const root = current.character(id)
			await mkdir(root, { recursive: true })
			await archiveStaleFiles({
				sourceFolder: root,
				destFolder: paths.local.character(id),
				match: (name) => name.startsWith(`${variant}.`),
				archivePrefix: `${variant}_`,
			})
			const finalFilename = `${variant}${ext}`
			const finalPath = join(root, finalFilename)
			const tmpPath = join(root, `.uploading-${variant}-${Date.now()}${ext}`)
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

	async function deleteVariant(
		id: string,
		variant: "avatar" | "fullbody",
	): Promise<void> {
		return writeVersioned(paths, readOnly.current, async (current) => {
			const root = current.character(id)
			await archiveStaleFiles({
				sourceFolder: root,
				destFolder: paths.local.character(id),
				match: (name) => name.startsWith(`${variant}.`),
				archivePrefix: `${variant}_`,
			})
		})
	}

	return {
		ensureFolder: folderOps.ensureFolder,
		removeFolder: folderOps.removeFolder,
		markDeleted: folderOps.markDeleted,
		moveFolderToTrash: folderOps.moveFolderToTrash,
		findVariantInVersion,
		writeVariant,
		deleteVariant,
	}
}
