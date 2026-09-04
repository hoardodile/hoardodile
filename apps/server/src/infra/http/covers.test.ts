import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { loadEnv } from "src/config/env.ts"
import { hashPassword } from "src/domain/auth/password.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

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

async function createResourceId(server: BuiltServer): Promise<string> {
	const resource = await server.app.resService.create({ name: "r" })
	return resource.id
}

/** A real 40×30 PNG so the eager cover render can decode it. */
async function makePng(r: number, g: number, b: number): Promise<Buffer> {
	return sharp({
		create: {
			width: 40,
			height: 30,
			channels: 3,
			background: { r, g, b },
		},
	})
		.png()
		.toBuffer()
}

function putCover(built: BuiltServer, cookie: string, id: string, png: Buffer) {
	return built.app.inject({
		method: "PUT",
		url: `/api/resources/${id}/cover`,
		remoteAddress: REMOTE_ADDR,
		headers: {
			cookie,
			"x-filename": "cover.png",
			"content-type": "application/octet-stream",
		},
		payload: png,
	})
}

function getOriginalCover(built: BuiltServer, cookie: string, id: string) {
	return built.app.inject({
		method: "GET",
		url: `/api/resources/${id}/cover?size=original&format=image`,
		remoteAddress: REMOTE_ADDR,
		headers: { cookie },
	})
}

describe("resource cover HTTP", () => {
	let root: string
	let built: BuiltServer
	let cookie: string
	let id: string

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "app-covers-"))
		built = await bootstrap(root)
		await built.app.ready()
		cookie = await login(built)
		id = await createResourceId(built)
	})

	afterEach(async () => {
		await built.close()
		built.db.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("original cover response revalidates instead of trusting a year-long immutable cache", async () => {
		const png = await makePng(1, 2, 3)
		const put = await putCover(built, cookie, id, png)
		expect(put.statusCode).toBe(201)

		const get = await getOriginalCover(built, cookie, id)
		expect(get.statusCode).toBe(200)
		expect(get.headers["cache-control"]).toBe("private, no-cache")
		expect(get.headers.etag).toBeTruthy()
		expect(Buffer.from(get.rawPayload)).toEqual(png)
	})

	test("still revalidates the content after replace/delete", async () => {
		const pngA = await makePng(200, 10, 10)
		await putCover(built, cookie, id, pngA)
		const first = await getOriginalCover(built, cookie, id)
		expect(first.statusCode).toBe(200)
		expect(Buffer.from(first.rawPayload)).toEqual(pngA)

		// An unchanged cover answers 304 to its own etag.
		const unchanged = await built.app.inject({
			method: "GET",
			url: `/api/resources/${id}/cover?size=original&format=image`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie, "if-none-match": String(first.headers.etag) },
		})
		expect(unchanged.statusCode).toBe(304)

		// Deleting the cover clears the endpoint.
		const del = await built.app.inject({
			method: "DELETE",
			url: `/api/resources/${id}/cover`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(del.statusCode).toBe(204)
		const gone = await getOriginalCover(built, cookie, id)
		expect(gone.statusCode).toBe(404)

		// Replacing it with different bytes serves exactly those bytes.
		const pngB = await makePng(10, 10, 200)
		await putCover(built, cookie, id, pngB)
		const fresh = await getOriginalCover(built, cookie, id)
		expect(fresh.statusCode).toBe(200)
		expect(Buffer.from(fresh.rawPayload)).toEqual(pngB)
	})
})
