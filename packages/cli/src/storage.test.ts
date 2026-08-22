import { mkdirSync, mkdtempSync, rmSync } from "node:fs"
import { createRequire } from "node:module"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { buildArchiveResourceAPI } from "./runner.ts"
import { openStorage } from "./storage.ts"

const requireBuiltin: (id: "node:sqlite") => typeof import("node:sqlite") =
	createRequire(import.meta.url)

/**
 * The storage reader is the one place the dev loop touches a user's
 * library, so these tests pin both halves of its contract: it reads the
 * plugin-visible slice correctly, and it never writes.
 */

/** Build a storage root with one resource, its archive and its state. */
function seedStorage(root: string): void {
	const { DatabaseSync } = requireBuiltin("node:sqlite")
	const db = new DatabaseSync(join(root, "app.sqlite"))
	db.exec(`
		CREATE TABLE resources (
			id TEXT PRIMARY KEY, name TEXT NOT NULL, content_plugin_id TEXT,
			file_version INTEGER NOT NULL DEFAULT 1,
			created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
			deleted_at INTEGER
		);
		CREATE TABLE resource_meta (
			resource_id TEXT PRIMARY KEY, cover_meta TEXT, source_meta TEXT,
			search_meta TEXT, file_stats TEXT, hashes_meta TEXT,
			built_at INTEGER NOT NULL
		);
		CREATE TABLE comments (
			id TEXT PRIMARY KEY, body TEXT NOT NULL, created_at INTEGER NOT NULL,
			deleted_at INTEGER, floor INTEGER, anchor_resource_id TEXT,
			anchor_data TEXT
		);
		CREATE TABLE comment_resources (comment_id TEXT, resource_id TEXT);
		CREATE TABLE danmakus (
			id TEXT PRIMARY KEY, anchor_resource_id TEXT NOT NULL,
			anchor_data TEXT NOT NULL, text TEXT NOT NULL,
			color TEXT NOT NULL DEFAULT '', mode TEXT NOT NULL DEFAULT 'scroll',
			created_at INTEGER NOT NULL
		);
		CREATE TABLE plugin_preferences (
			plugin_id TEXT, key TEXT, value TEXT, updated_at INTEGER
		);
		CREATE TABLE plugin_cache (
			plugin_id TEXT, res_id TEXT, key TEXT, value TEXT, updated_at INTEGER
		);

		INSERT INTO resources VALUES
			('res-1', 'Sunset shots', 'plugin-a', 1, 200, 200, NULL),
			('res-2', 'Older album', 'plugin-a', 1, 100, 100, NULL),
			('res-gone', 'Trashed', 'plugin-a', 1, 300, 300, 400);
		INSERT INTO resource_meta VALUES
			('res-1', NULL, '{"width":800}', '{"v":1}', '{"count":2}', NULL, 1);
		INSERT INTO comments VALUES
			('c-1', 'nice page', 10, NULL, 1, 'res-1', '{"data":{"page":3}}'),
			('c-2', 'deleted', 11, 12, 2, 'res-1', NULL);
		INSERT INTO comment_resources VALUES ('c-1', 'res-1'), ('c-2', 'res-1');
		INSERT INTO danmakus VALUES
			('d-1', 'res-1', '{"data":{"timeMs":500}}', 'hi', '#fff', 'top', 20);
		INSERT INTO plugin_preferences VALUES
			('plugin-a', 'theme', 'dark', 1), ('plugin-b', 'theme', 'light', 1);
		INSERT INTO plugin_cache VALUES
			('plugin-a', 'res-1', 'page', '7', 1),
			('plugin-a', 'res-2', 'page', '1', 1);
	`)
	db.close()
}

/** Write bare files at the path the storage layout expects. */
async function seedArchive(
	root: string,
	resId: string,
	files: Readonly<Record<string, string>>,
): Promise<void> {
	const dir = join(root, "versions", "1", "resources", resId)
	mkdirSync(dir, { recursive: true })
	const { writeFile } = await import("node:fs/promises")
	for (const [name, content] of Object.entries(files)) {
		await writeFile(join(dir, name), content)
	}
}

describe("openStorage", () => {
	let root: string

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "hoardodile-storage-"))
		seedStorage(root)
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("lists live resources newest first and skips trashed ones", () => {
		const storage = openStorage(root)
		try {
			const rows = storage.listResources()
			expect(rows.map((r) => r.id)).toEqual(["res-1", "res-2"])
			expect(rows[0]).toMatchObject({
				name: "Sunset shots",
				contentPluginId: "plugin-a",
				fileVersion: 1,
				sourceMeta: { width: 800 },
				searchMeta: { v: 1 },
				fileStats: { count: 2 },
			})
		} finally {
			storage.close()
		}
	})

	test("reads only the plugin-visible state of one resource", () => {
		const storage = openStorage(root)
		try {
			const state = storage.readState("res-1", "plugin-a")
			expect(state.name).toBe("Sunset shots")
			// Deleted comments never reach a plugin.
			expect(state.messages).toHaveLength(1)
			expect(state.messages[0]).toMatchObject({
				id: "c-1",
				body: "nice page",
				anchor: { resId: "res-1", data: { page: 3 } },
			})
			expect(state.danmaku).toEqual([
				{
					id: "d-1",
					anchor: { resId: "res-1", data: { timeMs: 500 } },
					text: "hi",
					color: "#fff",
					mode: "top",
					createdAt: 20,
				},
			])
			// Scoped to this plugin, and to this resource for the cache.
			expect(state.prefs).toEqual({ theme: "dark" })
			expect(state.cache).toEqual({ page: "7" })
		} finally {
			storage.close()
		}
	})

	test("resolves the archive path from the resource's file version", () => {
		const storage = openStorage(root)
		try {
			const resource = storage.findResource("res-1")
			expect(resource).toBeDefined()
			expect(storage.archivePath(resource!)).toBe(
				join(root, "versions", "1", "resources", "res-1"),
			)
		} finally {
			storage.close()
		}
	})

	test("serves entries from the resource's own archive", async () => {
		await seedArchive(root, "res-1", {
			"001.txt": "first page",
			"002.txt": "second page",
		})
		const storage = openStorage(root)
		try {
			const resource = storage.findResource("res-1")
			const api = buildArchiveResourceAPI(storage.archivePath(resource!))
			expect([...(await api.listFileNames())].sort()).toEqual([
				"001.txt",
				"002.txt",
			])
			expect(new TextDecoder().decode(await api.readFile("001.txt"))).toBe(
				"first page",
			)
			expect(await api.sniff("001.txt")).toMatchObject({
				mime: "text/plain",
				kind: "other",
			})
		} finally {
			storage.close()
		}
	})

	test("rejects a directory that is not a storage root", () => {
		const empty = mkdtempSync(join(tmpdir(), "hoardodile-empty-"))
		try {
			expect(() => openStorage(empty)).toThrow(/no app.sqlite/)
		} finally {
			rmSync(empty, { recursive: true, force: true })
		}
	})

	test("never writes to the library it reads", () => {
		const storage = openStorage(root)
		try {
			storage.listResources()
			storage.readState("res-1", "plugin-a")
			const { DatabaseSync } = requireBuiltin("node:sqlite")
			// A second read-only handle proves the first took no write lock
			// and left the file unchanged.
			const probe = new DatabaseSync(join(root, "app.sqlite"), {
				readOnly: true,
			})
			expect(
				probe.prepare("SELECT COUNT(*) AS n FROM resources").get(),
			).toEqual({ n: 3 })
			probe.close()
		} finally {
			storage.close()
		}
	})
})
