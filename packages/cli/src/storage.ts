import { copyFileSync, existsSync, mkdtempSync, readdirSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import type { DatabaseSync } from "node:sqlite"
import { createStoragePaths } from "@hoardodile/host/hoard"

/**
 * `node:sqlite` is loaded through `createRequire` rather than a static
 * import: the bundler's builtin table predates it and rewrites the
 * specifier to a bare `sqlite`, which Node cannot resolve. The
 * annotation keeps the call fully typed without an assertion.
 */
const requireBuiltin: (id: "node:sqlite") => typeof import("node:sqlite") =
	createRequire(import.meta.url)

/**
 * Read-only access to a real hoardodile storage root, so a plugin can
 * be developed against the library it will actually run in.
 *
 * Two rules shape everything here:
 *
 * 1. **Read-only, always.** The database is opened `readOnly` and the
 *    archives are read through the host's zip container. Nothing in the
 *    dev loop writes to a user's library — plugin writes land in the
 *    workbench's in-memory mock instead.
 * 2. **Only what a plugin could see anyway.** Queries are limited to the
 *    resource row, its rebuilt metadata, its comments and danmaku, and
 *    this plugin's own preferences and cache. Auth, sessions, the
 *    footprint log and every other table stay untouched.
 *
 * `node:sqlite` is a Node builtin, so reading a library costs the CLI no
 * native dependency.
 */

export type StorageResource = {
	readonly id: string
	readonly name: string
	readonly contentPluginId?: string
	readonly fileVersion: number
	readonly sourceMeta?: unknown
	readonly searchMeta?: unknown
	readonly fileStats?: { readonly count?: number; readonly sizeBytes?: number }
}

export type StorageResourceState = {
	readonly name: string
	readonly messages: readonly unknown[]
	readonly danmaku: readonly unknown[]
	readonly prefs: Readonly<Record<string, string>>
	readonly cache: Readonly<Record<string, string>>
}

export type StorageReader = {
	/** Resources in the library, newest first. */
	readonly listResources: () => readonly StorageResource[]
	readonly findResource: (resId: string) => StorageResource | undefined
	/** Plugin-visible stored state for one resource. */
	readonly readState: (resId: string, pluginId: string) => StorageResourceState
	/** Absolute path of a resource's bare-file source folder. */
	readonly archivePath: (resource: StorageResource) => string
	readonly close: () => void
}

function parseJson(value: unknown): unknown {
	if (typeof value !== "string" || value.length === 0) return undefined
	try {
		return JSON.parse(value)
	} catch {
		return undefined
	}
}

function asString(value: unknown): string | undefined {
	return typeof value === "string" && value.length > 0 ? value : undefined
}

/**
 * Open the library database read-only. A live server holds the write
 * lock and keeps its WAL alongside; SQLite can still read that, but a
 * read-only handle cannot recover a hot journal — so on failure the
 * database and its sidecars are copied to a temp dir and the copy is
 * opened instead. The user's files are never modified either way.
 */
function openReadOnly(dbPath: string): DatabaseSync {
	const { DatabaseSync: Database } = requireBuiltin("node:sqlite")
	try {
		return new Database(dbPath, { readOnly: true })
	} catch (err) {
		const snapshotDir = mkdtempSync(join(tmpdir(), "hoardodile-wb-"))
		const dir = resolve(dbPath, "..")
		const base = dbPath.slice(dir.length + 1)
		let copied = false
		for (const entry of readdirSync(dir)) {
			if (!entry.startsWith(base)) continue
			copyFileSync(join(dir, entry), join(snapshotDir, entry))
			copied = entry === base || copied
		}
		if (!copied) throw err
		console.log(
			`[hoardodile] database is busy — reading a temporary copy (${snapshotDir})`,
		)
		return new Database(join(snapshotDir, base), { readOnly: true })
	}
}

export function openStorage(rootDir: string): StorageReader {
	const root = resolve(rootDir)
	const dbPath = join(root, "app.sqlite")
	if (!existsSync(dbPath)) {
		throw new Error(
			`no app.sqlite in ${root} — point --storage at a hoardodile data root`,
		)
	}
	const db = openReadOnly(dbPath)
	const paths = createStoragePaths({ root })

	function rowToResource(row: Record<string, unknown>): StorageResource {
		const stats = parseJson(row.file_stats)
		return {
			id: String(row.id),
			name: String(row.name ?? row.id),
			contentPluginId: asString(row.content_plugin_id),
			fileVersion: Number(row.file_version ?? 1),
			sourceMeta: parseJson(row.source_meta),
			searchMeta: parseJson(row.search_meta),
			fileStats:
				typeof stats === "object" && stats !== null
					? (stats as StorageResource["fileStats"])
					: undefined,
		}
	}

	const listStmt = db.prepare(
		`SELECT r.id, r.name, r.content_plugin_id, r.file_version,
		        m.source_meta, m.search_meta, m.file_stats
		   FROM resources r
		   LEFT JOIN resource_meta m ON m.resource_id = r.id
		  WHERE r.deleted_at IS NULL
		  ORDER BY r.created_at DESC`,
	)
	const findStmt = db.prepare(
		`SELECT r.id, r.name, r.content_plugin_id, r.file_version,
		        m.source_meta, m.search_meta, m.file_stats
		   FROM resources r
		   LEFT JOIN resource_meta m ON m.resource_id = r.id
		  WHERE r.id = ?`,
	)
	const commentsStmt = db.prepare(
		`SELECT c.id, c.body, c.created_at, c.floor, c.anchor_data
		   FROM comments c
		   JOIN comment_resources cr ON cr.comment_id = c.id
		  WHERE cr.resource_id = ? AND c.deleted_at IS NULL
		  ORDER BY c.created_at ASC`,
	)
	const danmakuStmt = db.prepare(
		`SELECT id, anchor_data, text, color, mode, created_at
		   FROM danmakus
		  WHERE anchor_resource_id = ?
		  ORDER BY created_at ASC`,
	)
	const prefsStmt = db.prepare(
		`SELECT key, value FROM plugin_preferences WHERE plugin_id = ?`,
	)
	const cacheStmt = db.prepare(
		`SELECT key, value FROM plugin_cache WHERE plugin_id = ? AND res_id = ?`,
	)

	function keyValues(
		rows: readonly Record<string, unknown>[],
	): Record<string, string> {
		const out: Record<string, string> = {}
		for (const row of rows) out[String(row.key)] = String(row.value)
		return out
	}

	return {
		listResources() {
			return listStmt.all().map(rowToResource)
		},
		findResource(resId) {
			const row = findStmt.get(resId)
			return row === undefined ? undefined : rowToResource(row)
		},
		readState(resId, pluginId) {
			const resource = this.findResource(resId)
			return {
				name: resource?.name ?? resId,
				messages: commentsStmt.all(resId).map((row) => ({
					id: String(row.id),
					body: String(row.body ?? ""),
					createdAt: Number(row.created_at ?? 0),
					charIds: [],
					resIds: [resId],
					likeCount: 0,
					dislikeCount: 0,
					replyCount: 0,
					floor: row.floor === null ? undefined : Number(row.floor),
					anchor: {
						resId,
						data: (parseJson(row.anchor_data) as { data?: unknown })?.data,
					},
				})),
				danmaku: danmakuStmt.all(resId).map((row) => ({
					id: String(row.id),
					anchor: {
						resId,
						data: (parseJson(row.anchor_data) as { data?: unknown })?.data,
					},
					text: String(row.text ?? ""),
					color: String(row.color ?? ""),
					mode: String(row.mode ?? "scroll"),
					createdAt: Number(row.created_at ?? 0),
				})),
				prefs: keyValues(prefsStmt.all(pluginId)),
				cache: keyValues(cacheStmt.all(pluginId, resId)),
			}
		},
		archivePath(resource) {
			// Layout authority lives in @hoardodile/host, shared with the
			// server — no hand-rolled mirror of the versions/<v> shape.
			return paths.atVersion(resource.fileVersion).resource(resource.id)
		},
		close() {
			db.close()
		},
	}
}
