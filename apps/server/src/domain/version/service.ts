import { existsSync, statSync } from "node:fs"
import { resolve } from "node:path"
import {
	createNextVersion,
	listVersions,
	readActiveVersion,
	currentVersion as readCurrentVersion,
	versionedDbFile,
	versionedPath,
	writeActiveVersion,
} from "@hoardodile/host/hoard"
import { conflict, notFound } from "@hoardodile/shared"
import type { DbHandles } from "src/infra/db/connection.ts"
import {
	createSidecar,
	sidecarNumber,
	sidecarString,
} from "src/infra/json-sidecar.ts"

export type VersionEntry = {
	readonly version: number
	readonly current: boolean
	readonly active: boolean
	readonly dbSize: number
	readonly createdAt?: number
	readonly name?: string
	readonly note?: string
}

export type VersionCreateInput = {
	readonly name?: string
	readonly note?: string
}

export type VersionUpdateMetaInput = {
	readonly name?: string
	readonly note?: string
}

export type CreateVersionResult = {
	readonly previous: number
	readonly created: number
}

export type VersionService = {
	/**
	 * Enumerate every version under `<root>/versions/`, ascending. Each
	 * entry reports its byte-size on disk plus the `current` (max) and
	 * `active` (currently-viewed) flags.
	 */
	list(): readonly VersionEntry[]
	/** Maximum version on disk. */
	current(): number
	/** Version the running server is viewing. */
	active(): number
	/**
	 * Snapshot the live DB into `versions/<current+1>/app.sqlite`.
	 *
	 * The caller is responsible for emitting the
	 * `version.changed` signal after this returns so the server
	 * restarts and re-resolves the storage context.
	 *
	 * @throws {DomainError} `version.read_only_archive` when the server
	 *   is viewing a past archive.
	 */
	create(input?: VersionCreateInput): CreateVersionResult
	/**
	 * Persist the active version pointer. The new value MUST refer to a
	 * version directory that exists. The caller is responsible for
	 * emitting `version.changed` afterwards.
	 *
	 * @throws {DomainError} `version.not_found` when `version` is unknown.
	 */
	switchTo(version: number): void
	/**
	 * Update user-visible metadata (`name` and/or `note`) attached to a
	 * version. Both fields are persisted in the version directory's
	 * `meta.json` so they travel with the archive.
	 *
	 * @throws {DomainError} `version.not_found` when `version` does not exist.
	 */
	updateMeta(version: number, input: VersionUpdateMetaInput): void
}

export type VersionServiceDeps = {
	readonly db: DbHandles
	readonly storageRoot: string
	readonly readOnly: boolean
}

/**
 * Build a {@link VersionService}. Pure closure; no hidden singletons.
 *
 * The service operates against the on-disk version state directly so its
 * answers stay correct even after the FS has been mutated by another
 * server instance (e.g. during a restart triggered by `create()`).
 */
export function createVersionService(deps: VersionServiceDeps): VersionService {
	const { db, storageRoot, readOnly } = deps

	function list(): readonly VersionEntry[] {
		const all = listVersions(storageRoot)
		const cur = readCurrentVersion(storageRoot)
		const act = readActiveVersion(storageRoot)
		return all.map((v) => {
			const meta = readVersionMeta(storageRoot, v)
			return {
				version: v,
				current: v === cur,
				active: v === act,
				dbSize: dbFileSize(storageRoot, v),
				createdAt: meta?.createdAt,
				name: meta?.name,
				note: meta?.note,
			}
		})
	}

	function current(): number {
		return readCurrentVersion(storageRoot)
	}

	function active(): number {
		return readActiveVersion(storageRoot)
	}

	function create(input?: VersionCreateInput): CreateVersionResult {
		if (readOnly) {
			throw conflict(
				"version.read_only_archive",
				"cannot create a new version while viewing a past archive",
			)
		}
		// Persist the metadata for the version that is about to be archived
		// *before* the next version directory is created. At this point the
		// target version is still the current (writable) version, so the
		// write does not violate the "past versions are frozen" rule.
		const previous = readCurrentVersion(storageRoot)
		const trimmedName = input?.name?.trim()
		const trimmedNote = input?.note?.trim()
		writeVersionMeta(storageRoot, previous, {
			createdAt: Date.now(),
			name:
				trimmedName !== undefined && trimmedName.length > 0
					? trimmedName
					: undefined,
			note:
				trimmedNote !== undefined && trimmedNote.length > 0
					? trimmedNote
					: undefined,
		})
		const result = createNextVersion(storageRoot, (destination) => {
			db.vacuumInto(destination)
		})
		return result
	}

	function switchTo(version: number): void {
		writeActiveVersion(storageRoot, version)
	}

	function updateMeta(version: number, input: VersionUpdateMetaInput): void {
		const all = listVersions(storageRoot)
		if (!all.includes(version)) {
			throw notFound("version.not_found", `version ${version} does not exist`, {
				version,
			})
		}
		const current = readCurrentVersion(storageRoot)
		if (version !== current) {
			throw conflict(
				"version.read_only_archive",
				`version ${version} is archived; metadata can only be edited for the current version ${current}`,
				{ version, current },
			)
		}
		const existing = readVersionMeta(storageRoot, version)
		const trimmedName = input.name?.trim()
		const trimmedNote = input.note?.trim()

		const nextName =
			input.name === undefined
				? existing?.name
				: trimmedName && trimmedName.length > 0
					? trimmedName
					: undefined
		const nextNote =
			input.note === undefined
				? existing?.note
				: trimmedNote && trimmedNote.length > 0
					? trimmedNote
					: undefined

		writeVersionMeta(storageRoot, version, {
			createdAt: existing?.createdAt,
			name: nextName,
			note: nextNote,
		})
	}

	return { list, current, active, create, switchTo, updateMeta }
}

function dbFileSize(root: string, version: number): number {
	const path = versionedDbFile(root, version)
	if (existsSync(path)) {
		try {
			return statSync(path).size
		} catch {
			return 0
		}
	}
	// Current version: no archive yet; the live DB lives at the storage root.
	const runtimePath = resolve(root, "app.sqlite")
	if (!existsSync(runtimePath)) return 0
	try {
		return statSync(runtimePath).size
	} catch {
		return 0
	}
}

type VersionMeta = {
	readonly createdAt?: number
	readonly name?: string
	readonly note?: string
}

const VERSION_META_FILENAME = "meta.json"

function versionMetaPath(root: string, version: number): string {
	return resolve(versionedPath(root, version), VERSION_META_FILENAME)
}

const versionMetaSidecar = createSidecar<VersionMeta>({
	createdAt: sidecarNumber(1),
	name: sidecarString,
	note: sidecarString,
})

function readVersionMeta(
	root: string,
	version: number,
): VersionMeta | undefined {
	return versionMetaSidecar.read(versionMetaPath(root, version))
}

function writeVersionMeta(
	root: string,
	version: number,
	meta: VersionMeta,
): void {
	versionMetaSidecar.write(versionMetaPath(root, version), meta)
}
