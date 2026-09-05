import { existsSync } from "node:fs"
import { join } from "node:path"
import { versionedDbFile } from "@hoardodile/host/hoard"
import { conflict, notFound } from "@hoardodile/shared"
import { openDb } from "src/infra/db/connection.ts"
import {
	cloneSqliteFile,
	verifySqliteIntegrity,
} from "src/infra/db/snapshot.ts"
import type { StoragePaths } from "./paths.ts"

/**
 * Stage a read-only viewing clone of `version`'s DB into
 * `<root>/local/cache/tmp/view-<version>.sqlite`. Returns the cloned
 * path. The caller opens it in `readonly: true` mode and is responsible
 * for removing it on shutdown.
 *
 * Cloning (rather than opening the version DB directly) avoids any risk
 * of corrupting the immutable archive via SQLite WAL/SHM sidecars or
 * stray writes. The clone lives under the cache root so clear cache
 * wipes it together with the other derived data.
 *
 * @throws DomainError `version.db_missing` when the version has no DB
 *   file.
 * @throws DomainError `version.clone_corrupt` when the clone fails the
 *   integrity check.
 */
export function stageViewCloneDb(paths: StoragePaths, version: number): string {
	const src = versionedDbFile(paths.root, version)
	if (!existsSync(src)) {
		throw notFound("version.db_missing", `version ${version} has no DB file`, {
			version,
		})
	}
	const dest = join(paths.local.tmp(), `view-${version}.sqlite`)
	cloneSqliteFile(src, dest)
	// Verify the clone before we hand it back.
	if (!verifySqliteIntegrity(dest)) {
		throw conflict(
			"version.clone_corrupt",
			`view clone for version ${version} failed integrity check`,
			{ version },
		)
	}
	const handles = openDb(dest)
	try {
		handles.validateCompatibility?.()
		handles.runMigrations()
	} finally {
		handles.close()
	}
	return dest
}
