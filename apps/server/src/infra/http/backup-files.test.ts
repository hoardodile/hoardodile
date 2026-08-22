import { mkdtempSync, readdirSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureBootstrapVersion } from "@hoardodile/host/hoard"
import { loadEnv } from "src/config/env.ts"
import { hashPassword } from "src/domain/auth/password.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import {
	type BuiltServer,
	buildServer,
	reloadStorageContext,
} from "src/server.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

const REMOTE_ADDR = "127.0.0.1"
const SQLITE_MAGIC = "SQLite format 3\0"

async function bootstrap(storageRoot: string): Promise<BuiltServer> {
	const env = loadEnv({
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
		STORAGE_ROOT: storageRoot,
	} as NodeJS.ProcessEnv)
	const db = openDb(":memory:")
	db.runMigrations()
	const passwordHash = await hashPassword("hunter2")
	db.db
		.insert(schema.auth)
		.values({ singleton: 1, passwordHash, updatedAt: Date.now() })
		.run()
	ensureBootstrapVersion(storageRoot)
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

function expectSqlite(res: { statusCode: number; rawPayload: Buffer }): void {
	expect(res.statusCode).toBe(200)
	expect(res.rawPayload.subarray(0, 16).toString("latin1")).toBe(SQLITE_MAGIC)
}

describe("backup/version database downloads", () => {
	let root: string
	let built: BuiltServer
	let cookie: string

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "app-dbdownload-"))
		built = await bootstrap(root)
		await built.app.ready()
		cookie = await login(built)
	})

	afterEach(async () => {
		await built.close()
		built.db.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("downloads a manual backup as attachment", async () => {
		const backup = await built.app.backupService.create()
		const res = await built.app.inject({
			method: "GET",
			url: `/api/backups/${backup.fileName}/download`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expectSqlite(res)
		expect(res.headers["content-disposition"]).toContain("attachment")
		expect(res.headers["content-disposition"]).toContain(backup.fileName)
	})

	test("backup download 404s for a missing file and 400s for traversal", async () => {
		const missing = await built.app.inject({
			method: "GET",
			url: "/api/backups/app-1.sqlite/download",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(missing.statusCode).toBe(404)

		const traversal = await built.app.inject({
			method: "GET",
			url: "/api/backups/..%2Fapp.sqlite/download",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(traversal.statusCode).toBe(400)
	})

	test("downloads require a session", async () => {
		const res = await built.app.inject({
			method: "GET",
			url: "/api/versions/1/db.sqlite",
			remoteAddress: REMOTE_ADDR,
		})
		expect(res.statusCode).toBe(401)
	})

	test("downloads the latest version via a consistent live snapshot", async () => {
		const res = await built.app.inject({
			method: "GET",
			url: "/api/versions/1/db.sqlite",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expectSqlite(res)
		expect(res.headers["content-disposition"]).toContain("app-v1.sqlite")

		// The temp snapshot must be removed once the stream finished; the
		// close event can lag the response by a tick, so poll briefly.
		const tmpDir = createStoragePaths({ root }).local.tmp()
		let leftovers: string[] = []
		for (let attempt = 0; attempt < 20; attempt++) {
			leftovers = readdirSync(tmpDir).filter((name) =>
				name.startsWith("db-download-"),
			)
			if (leftovers.length === 0) break
			await new Promise((resolve) => setTimeout(resolve, 100))
		}
		expect(leftovers).toEqual([])
	})

	test("rejects invalid or unknown versions", async () => {
		const zero = await built.app.inject({
			method: "GET",
			url: "/api/versions/0/db.sqlite",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(zero.statusCode).toBe(400)

		const future = await built.app.inject({
			method: "GET",
			url: "/api/versions/999/db.sqlite",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(future.statusCode).toBe(404)
	})

	test("downloads an archived version's frozen snapshot", async () => {
		await built.app.versionService.create()
		await reloadStorageContext(built.app)
		expect(built.app.paths.latestVersion).toBe(2)

		const archived = await built.app.inject({
			method: "GET",
			url: "/api/versions/1/db.sqlite",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expectSqlite(archived)
		expect(archived.headers["content-disposition"]).toContain("app-v1.sqlite")

		// The new latest version still resolves through the live snapshot path.
		const latest = await built.app.inject({
			method: "GET",
			url: "/api/versions/2/db.sqlite",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expectSqlite(latest)
	})
})
