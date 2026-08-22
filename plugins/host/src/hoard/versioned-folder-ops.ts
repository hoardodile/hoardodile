import { mkdir, readdir, rename, rm, writeFile } from "node:fs/promises"
import { extname, join } from "node:path"
import type { StoragePaths } from "./paths.ts"
import { writeVersioned } from "./write-versioned.ts"

export type VersionedFolderOps = {
	/** Ensure the current-version entity folder exists. */
	ensureFolder(id: string): Promise<void>
	/** Remove the current-version entity folder. Swallows missing-path errors. */
	removeFolder(id: string): Promise<void>
	/**
	 * When an entity's files live only under frozen past archives, hard
	 * delete cannot remove those folders; drop a `.deleted` placeholder in
	 * the current-version folder instead.
	 */
	markDeleted(id: string): Promise<string>
	/**
	 * Move the current-version entity folder into `local/trash/` with a
	 * unique directory name. No-op when the source path is missing (same as
	 * a removed folder). Returns the destination path (whether or not a move
	 * occurred).
	 */
	moveFolderToTrash(id: string): Promise<string>
}

/**
 * The four lifecycle operations shared by the resource and character
 * file-system layers. They differ only in which versioned folder they
 * target and how the trash / placeholder names are derived.
 *
 * `moveFolderToTrash` treats `EPERM`/`EBUSY`/`UNKNOWN` as transient Windows
 * locks (a file inside the folder is still open) and leaves the source in
 * place; a boot-time orphan sweep reclaims it later.
 *
 * `readOnly` is a live `{ current: boolean }` ref (the server's runtime
 * read-only flag), so a version switch mid-request re-reads it.
 */
export function buildVersionedFolderOps(
	paths: StoragePaths,
	readOnly: { readonly current: boolean },
	kind: "resource" | "character",
): VersionedFolderOps {
	const folderOf =
		(id: string) =>
		(current: StoragePaths["latest"]): string =>
			kind === "resource" ? current.resource(id) : current.character(id)
	const trashPrefix = kind === "resource" ? "resources-" : "characters-"
	const deletedKind = kind === "resource" ? "resources" : "characters"

	async function ensureFolder(id: string): Promise<void> {
		await writeVersioned(paths, readOnly.current, (current) =>
			mkdir(folderOf(id)(current), { recursive: true }),
		)
	}

	async function removeFolder(id: string): Promise<void> {
		await writeVersioned(paths, readOnly.current, (current) =>
			rm(folderOf(id)(current), {
				recursive: true,
				force: true,
			}).catch(() => {}),
		)
	}

	async function markDeleted(id: string): Promise<string> {
		return writeVersioned(paths, readOnly.current, async (current) => {
			const folder = folderOf(id)(current)
			await mkdir(folder, { recursive: true })
			const marker = current.deletedMarker(deletedKind, id)
			// Empty file: the placeholder's existence is the whole signal.
			await writeFile(marker, "")
			return marker
		})
	}

	async function moveFolderToTrash(id: string): Promise<string> {
		// write-local-only: trash directory is under local/, not versions/.
		await mkdir(paths.local.trash(), { recursive: true })
		return writeVersioned(paths, readOnly.current, async (current) => {
			const src = folderOf(id)(current)
			const dest = join(
				paths.local.trash(),
				`${trashPrefix}${id}-${Date.now()}`,
			)
			try {
				await rename(src, dest)
			} catch (err) {
				const code = (err as NodeJS.ErrnoException).code
				if (code === "ENOENT") {
					// Already gone; return dest as a conventional indicator.
					return dest
				}
				// Windows may throw EPERM/EBUSY/UNKNOWN when a file inside src is
				// still open (thumb pipeline, HTTP stream, zip handle, ...). Don't
				// let a transient lock block the hard-delete; an orphan sweep at
				// boot will reclaim the leftover folder later.
				if (code === "EPERM" || code === "EBUSY" || code === "UNKNOWN") {
					return src
				}
				throw err
			}
			return dest
		})
	}

	return {
		ensureFolder,
		removeFolder,
		markDeleted,
		moveFolderToTrash,
	}
}

/**
 * Move every file in `sourceFolder` whose name matches `match` into
 * `destFolder` under a timestamped archive name (`<prefix><stamp><ext>`, or
 * `<prefix><stamp>_<i><ext>` when several files match). Moves to the local
 * (non-synced) directory so replaced files are preserved without polluting
 * the versions sync scope. Creates `destFolder` on demand; silently ignores
 * ENOENT on source files and a missing source folder.
 */
export async function archiveStaleFiles(args: {
	readonly sourceFolder: string
	readonly destFolder: string
	readonly match: (name: string) => boolean
	readonly archivePrefix: string
}): Promise<void> {
	const { sourceFolder, destFolder, match, archivePrefix } = args
	const entries = await readdir(sourceFolder).catch(() => [])
	const stale = entries.filter(match)
	if (stale.length === 0) return
	await mkdir(destFolder, { recursive: true })
	const stamp = Date.now()
	await Promise.all(
		stale.map(async (name, i) => {
			const ext = extname(name)
			const archiveName =
				stale.length === 1
					? `${archivePrefix}${stamp}${ext}`
					: `${archivePrefix}${stamp}_${i}${ext}`
			try {
				await rename(join(sourceFolder, name), join(destFolder, archiveName))
			} catch (err) {
				if (!isEnoentError(err)) throw err
			}
		}),
	)
}

function isEnoentError(err: unknown): boolean {
	return err instanceof Error && "code" in err && err.code === "ENOENT"
}
