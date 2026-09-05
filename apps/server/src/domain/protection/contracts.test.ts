import { mkdtemp, readFile, rm, stat } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadEnv } from "src/config/env.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { openHostDatabase } from "src/infra/db/host.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, expect, it, vi } from "vitest"

const roots: string[] = []
let built: BuiltServer | undefined
afterEach(async () => {
	await built?.close()
	built = undefined
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true })
})
async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "protection-contract-"))
	roots.push(root)
	return root
}
const envFor = (root: string) =>
	loadEnv({
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
		STORAGE_ROOT: root,
		DISABLE_DEV_PLUGINS: "true",
	})

it("rejects a library without separate host state without converting its data or credentials", async () => {
	const root = await fixture(),
		path = join(root, "app.sqlite")
	const db = openDb(path)
	db.runMigrations()
	db.db
		.insert(schema.auth)
		.values({ singleton: 1, passwordHash: "old-private-hash", updatedAt: 1 })
		.run()
	db.close()
	const before = await readFile(path)
	await expect(buildServer({ env: envFor(root) })).rejects.toThrow(
		"unsupported storage layout",
	)
	expect(await readFile(path)).toEqual(before)
	await expect(stat(join(root, "local", "host.sqlite"))).rejects.toMatchObject({
		code: "ENOENT",
	})
})

it("keeps host credentials independent and exposes only complete-backup and archive job APIs", async () => {
	const root = await fixture()
	built = await buildServer({ env: envFor(root) })
	await built.app.ready()
	const app = built.app
	await app.inject({
		method: "POST",
		url: "/auth/setup",
		payload: { password: "contract-password" },
	})
	const login = await app.inject({
		method: "POST",
		url: "/auth/login",
		payload: { password: "contract-password" },
	})
	expect(login.statusCode).toBe(200)
	const cookie = login.cookies
		.map((entry) => `${entry.name}=${entry.value}`)
		.join("; ")
	for (const request of [
		{ method: "GET" as const, url: "/trpc/backup.list" },
		{ method: "POST" as const, url: "/trpc/backup.create", payload: {} },
		{
			method: "POST" as const,
			url: "/trpc/version.create",
			payload: { confirmArchive: true },
		},
		{ method: "GET" as const, url: "/api/backups/old.sqlite/download" },
		{ method: "GET" as const, url: "/api/versions/1/db.sqlite" },
	])
		expect(
			(await app.inject({ ...request, headers: { cookie } })).statusCode,
		).toBe(404)
	expect(app.db.select().from(schema.auth).all()).toEqual([])
	const created = await app.inject({
		method: "POST",
		url: "/trpc/protection.archive",
		headers: { cookie },
		payload: { note: "Archive job" },
	})
	expect(created.statusCode).toBe(200)
	const jobId = created.json().result.data.id
	if (typeof jobId !== "string") throw new Error("Expected an archive job ID")
	await vi.waitFor(
		() => {
			const job = app.protectionService.jobs.get(jobId)
			expect(job?.state, job?.error?.message).toBe("succeeded")
		},
		{ timeout: 15000 },
	)
	expect(app.versionService.current()).toBe(2)
	const health = (
		await app.inject({ method: "GET", url: "/api/health" })
	).json()
	expect(health.backup).toEqual({
		configured: false,
		automatic: false,
		lastBackupAt: null,
	})
	expect(health).not.toHaveProperty("autoSnapshot")
	const host = openHostDatabase(root)
	try {
		expect(host.db.select().from(schema.auth).get()?.passwordHash).toBeTruthy()
	} finally {
		host.close()
	}
}, 30000)
