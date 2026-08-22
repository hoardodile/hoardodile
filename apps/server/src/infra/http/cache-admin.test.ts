import { mkdtempSync, rmSync } from "node:fs"
import { mkdir, readdir, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { eq } from "drizzle-orm"
import { loadEnv } from "src/config/env.ts"
import { hashPassword } from "src/domain/auth/password.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import yauzl from "yauzl"

const REMOTE_ADDR = "127.0.0.1"

async function bootstrap(storageRoot: string): Promise<BuiltServer> {
	const env = loadEnv({
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
	} as NodeJS.ProcessEnv)
	const db = openDb(":memory:")
	db.runMigrations()
	const passwordHash = await hashPassword("hunter2")
	db.db
		.insert(schema.auth)
		.values({ singleton: 1, passwordHash, updatedAt: Date.now() })
		.run()
	return buildServer({
		env,
		dbHandles: db,
		storagePaths: createStoragePaths({ root: storageRoot }),
	})
}

async function login(server: BuiltServer): Promise<string> {
	const res = await server.app.inject({
		method: "POST",
		url: "/auth/login",
		remoteAddress: REMOTE_ADDR,
		payload: { password: "hunter2" },
	})
	const raw = res.headers["set-cookie"]
	const line = Array.isArray(raw) ? raw[0] : raw
	if (typeof line !== "string") throw new Error("no cookie")
	const head = line.split(";")[0]
	if (head === undefined) throw new Error("malformed cookie")
	return head
}

async function zipEntryNames(zipBuffer: Buffer): Promise<string[]> {
	const names: string[] = []
	await new Promise<void>((resolve, reject) => {
		yauzl.fromBuffer(zipBuffer, { lazyEntries: true }, (err, zipfile) => {
			if (err !== null || zipfile === undefined) {
				reject(err ?? new Error("missing zipfile"))
				return
			}
			zipfile.readEntry()
			zipfile.on("entry", (entry: { fileName: string }) => {
				names.push(entry.fileName.replace(/\\/g, "/"))
				zipfile.readEntry()
			})
			zipfile.on("end", () => resolve())
			zipfile.on("error", reject)
		})
	})
	return names.sort((a, b) =>
		a.localeCompare(b, undefined, { sensitivity: "base", numeric: true }),
	)
}

describe("DELETE /api/cache", () => {
	let root: string
	let built: BuiltServer
	let cookie: string

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "cache-admin-"))
		built = await bootstrap(root)
		await built.app.ready()
		cookie = await login(built)
	})

	afterEach(async () => {
		await built.close()
		built.db.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("wipes everything under local/cache and leaves persistent dirs", async () => {
		const paths = built.app.paths
		await mkdir(join(paths.local.cache(), "resources", "res-1"), {
			recursive: true,
		})
		await writeFile(
			join(paths.local.cache(), "resources", "res-1", "thumb.avif"),
			"thumb",
		)
		await mkdir(paths.local.tmp(), { recursive: true })
		await writeFile(paths.local.tmpFile("scratch.bin"), "scratch")
		await mkdir(paths.local.trash(), { recursive: true })
		await writeFile(join(paths.local.trash(), "keep.txt"), "keep")
		await mkdir(paths.local.logs(), { recursive: true })
		await writeFile(join(paths.local.logs(), "app.log"), "log")

		const res = await built.app.inject({
			method: "DELETE",
			url: "/api/cache",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})

		expect(res.statusCode).toBe(200)
		expect(res.json()).toEqual({ cleared: true, failed: [] })
		// The cache dir itself remains, but every entry under it is gone.
		await expect(readdir(paths.local.cache())).resolves.toEqual([])
		// Persistent host-only state is untouched.
		await expect(readdir(paths.local.trash())).resolves.toEqual(["keep.txt"])
		await expect(readdir(paths.local.logs())).resolves.toEqual(["app.log"])
	})

	test("succeeds when the cache directory does not exist", async () => {
		const res = await built.app.inject({
			method: "DELETE",
			url: "/api/cache",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})

		expect(res.statusCode).toBe(200)
		expect(res.json()).toEqual({ cleared: true, failed: [] })
	})

	test("clears recorded database metadata", async () => {
		const now = Date.now()
		built.db.db
			.insert(schema.resources)
			.values({
				id: "res-meta-1",
				name: "Meta keeper",
				createdAt: now,
				updatedAt: now,
			})
			.run()
		built.db.db
			.insert(schema.resourceMeta)
			.values({
				resourceId: "res-meta-1",
				sourceMeta: JSON.stringify({ title: "kept" }),
				searchMeta: JSON.stringify({ text: "kept" }),
				fileStats: JSON.stringify({ sizeBytes: 42, count: 1 }),
				builtAt: now,
			})
			.run()
		built.db.db
			.insert(schema.characters)
			.values({
				id: "char-meta-1",
				name: "Meta char",
				imageMeta: JSON.stringify({
					avatar: { empty: true },
					fullbody: { kind: "image" },
				}),
				createdAt: now,
				updatedAt: now,
			})
			.run()

		const res = await built.app.inject({
			method: "DELETE",
			url: "/api/cache",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})

		expect(res.statusCode).toBe(200)
		const row = built.db.db
			.select()
			.from(schema.resourceMeta)
			.where(eq(schema.resourceMeta.resourceId, "res-meta-1"))
			.get()
		expect(row?.sourceMeta).toBeNull()
		expect(row?.searchMeta).toBeNull()
		// fileStats is plugin-independent and stable — a cache clear keeps
		// it; rebuilds recompute it.
		expect(row?.fileStats).toBe(JSON.stringify({ sizeBytes: 42, count: 1 }))
		expect(row?.coverMeta).toBeNull()
		expect(row?.builtAt).toBeGreaterThanOrEqual(now)

		const charRow = built.db.db
			.select()
			.from(schema.characters)
			.where(eq(schema.characters.id, "char-meta-1"))
			.get()
		expect(charRow?.imageMeta).toBeNull()
		expect(charRow?.updatedAt).toBe(now)
	})
})

describe("GET /api/cache/trash/:name/download", () => {
	let root: string
	let built: BuiltServer
	let cookie: string

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "cache-admin-trash-"))
		built = await bootstrap(root)
		await built.app.ready()
		cookie = await login(built)
	})

	afterEach(async () => {
		await built.close()
		built.db.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("packs the trash entry's data/ content with relative names", async () => {
		const entryDir = join(
			built.app.paths.local.trash(),
			"resources-res-1-1700000000001",
		)
		await mkdir(join(entryDir, "data", "sub"), { recursive: true })
		await writeFile(join(entryDir, "data", "a.txt"), "hello-a")
		await writeFile(join(entryDir, "data", "sub", "b.txt"), "hello-b")
		// Root-level metadata dotfiles must not leak into the zip.
		await writeFile(join(entryDir, ".cover.webp"), "cover")

		const res = await built.app.inject({
			method: "GET",
			url: "/api/cache/trash/resources-res-1-1700000000001/download",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(200)
		const entries = await zipEntryNames(Buffer.from(res.rawPayload))
		expect(entries).toEqual(["a.txt", "sub/b.txt"])
	})

	test("404s when the trash entry has no content root", async () => {
		await mkdir(
			join(built.app.paths.local.trash(), "resources-res-2-1700000000002"),
			{ recursive: true },
		)

		const res = await built.app.inject({
			method: "GET",
			url: "/api/cache/trash/resources-res-2-1700000000002/download",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(404)
	})

	test("404s for non-resource entries", async () => {
		await mkdir(join(built.app.paths.local.trash(), "db-1700000000003"), {
			recursive: true,
		})

		const res = await built.app.inject({
			method: "GET",
			url: "/api/cache/trash/db-1700000000003/download",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(404)
	})
})
