import { buildImageSlotFiles } from "src/infra/image-slots/files.ts"
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
 *
 * The slot mechanics (versioned write, stale-file archiving, trash and
 * `.deleted` markers) live in the shared image-slot kernel
 * (`src/infra/image-slots/files.ts`); this module only pins the
 * character folder and the `avatar` / `fullbody` slot names.
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
	const slots = buildImageSlotFiles({
		paths,
		readOnly,
		subjectKind: "character",
	})

	return {
		ensureFolder: slots.ensureFolder,
		removeFolder: slots.removeFolder,
		markDeleted: slots.markDeleted,
		moveFolderToTrash: slots.moveFolderToTrash,
		findVariantInVersion: (id, version, variant) =>
			slots.findSlotInVersion(id, version, variant),
		writeVariant: (id, variant, ext, sourcePath) =>
			slots.writeSlot(id, variant, ext, sourcePath),
		deleteVariant: (id, variant) => slots.removeSlot(id, variant),
	}
}
