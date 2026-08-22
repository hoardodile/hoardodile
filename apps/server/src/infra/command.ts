import { conflict } from "@hoardodile/shared"
import type { SqliteDb } from "src/infra/db/connection.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"

/**
 * Lightweight, functional command gate.
 *
 * All service-layer writes should be dispatched through {@link runWrite} so
 * the active `readOnly` mode is checked at a single, auditable point. The
 * service functions themselves remain pure business logic and do not need to
 * know about the archive viewing mode.
 */
export type CommandDeps = {
	readonly db: SqliteDb
	readonly paths: StoragePaths
	readonly readOnly: boolean
}

export type WriteCommand<T> = (deps: CommandDeps) => T | Promise<T>

/**
 * Execute a write command, first verifying the server is not in read-only
 * archive viewing mode.
 *
 * @throws DomainError with kind `server.read_only_archive` when `readOnly` is true.
 */
export async function runWrite<T>(
	deps: CommandDeps,
	cmd: WriteCommand<T>,
): Promise<T> {
	if (deps.readOnly) {
		throw conflict("server.read_only_archive", "write operations are blocked")
	}
	return await cmd(deps)
}
