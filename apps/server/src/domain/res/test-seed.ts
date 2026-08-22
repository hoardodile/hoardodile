import { mkdir, writeFile } from "node:fs/promises"
import { join } from "node:path"
import type { FileStats } from "@hoardodile/schemas"
import { buildResourceRepository } from "src/domain/res/repo.ts"
import type { DbHandles } from "src/infra/db/connection.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"

/**
 * Seed a resource's source artifact on disk as bare files under its
 * content root (`data/`) and patch `file_stats` in the DB so the read
 * path can locate it. Used by tests that need to populate a resource
 * without going through the full upload pipeline. Entry names with `/`
 * are written into subdirectories.
 */
export async function seedResourceArtifact(
	deps: {
		readonly db: DbHandles
		readonly paths: StoragePaths
	},
	id: string,
	files: readonly { readonly name: string; readonly bytes: Buffer }[],
): Promise<void> {
	if (files.length === 0) {
		throw new Error("seedResourceArtifact requires at least one file")
	}
	const root = deps.paths.latest.resourceData(id)
	await mkdir(root, { recursive: true })
	for (const file of files) {
		const dest = join(root, file.name)
		await mkdir(join(dest, ".."), { recursive: true })
		await writeFile(dest, file.bytes)
	}

	const total = files.reduce((acc, f) => acc + f.bytes.length, 0)
	const fileStats: FileStats = {
		count: files.length,
		sizeBytes: total,
	}

	buildResourceRepository(deps.db.db).patchMeta(
		id,
		{ fileStats: JSON.stringify(fileStats) },
		Date.now(),
	)
}
