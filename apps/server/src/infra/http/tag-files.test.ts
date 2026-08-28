import { existsSync, mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { ensureBootstrapVersion } from "@hoardodile/host/hoard"
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

/** Create a live category + tag row directly (no tRPC round-trip). */
function seedTag(server: BuiltServer, name: string): string {
	const now = Date.now()
	const catId = "cat-http-1"
	server.db.db
		.insert(schema.categories)
		.values({
			id: catId,
			name: "C",
			intro: "",
			color: "",
			kind: "common",
			position: 0,
			pinned: false,
			createdAt: now,
			updatedAt: now,
		})
		.run()
	const tagId = `tag-${name}`
	server.db.db
		.insert(schema.tags)
		.values({ id: tagId, name, catId, createdAt: now, updatedAt: now })
		.run()
	return tagId
}

describe("tag image routes", () => {
	let root: string
	let built: BuiltServer
	let cookie: string

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "app-tag-http-"))
		built = await bootstrap(root)
		await built.app.ready()
		cookie = await login(built)
	})

	afterEach(async () => {
		await built.close()
		built.db.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("PUT uploads art, GET serves the original, DELETE clears it", async () => {
		const id = seedTag(built, "upload")
		const put = await built.app.inject({
			method: "PUT",
			url: `/api/tags/${id}/images/image`,
			remoteAddress: REMOTE_ADDR,
			headers: {
				cookie,
				"content-type": "application/octet-stream",
				"x-filename": "art.png",
			},
			payload: Buffer.from("fake-image"),
		})
		expect(put.statusCode).toBe(201)
		expect(JSON.parse(put.body)).toEqual({
			path: `/api/tags/${id}/images/image`,
		})

		const got = await built.app.inject({
			method: "GET",
			url: `/api/tags/${id}/images/image`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(got.statusCode).toBe(200)
		expect(got.rawPayload.toString()).toBe("fake-image")
		expect(await built.app.tagService.getImageVersion(id)).toBe(1)

		const del = await built.app.inject({
			method: "DELETE",
			url: `/api/tags/${id}/images/image`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(del.statusCode).toBe(204)

		const after = await built.app.inject({
			method: "GET",
			url: `/api/tags/${id}/images/image`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(after.statusCode).toBe(404)
	})

	test("thumb 404s while no art exists (and does not render)", async () => {
		const id = seedTag(built, "thumb")
		const res = await built.app.inject({
			method: "GET",
			url: `/api/tags/${id}/thumb/image`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(404)
	})

	test("rejects bad extensions, missing filename and wrong content type", async () => {
		const id = seedTag(built, "reject")
		const ext = await built.app.inject({
			method: "PUT",
			url: `/api/tags/${id}/images/image`,
			remoteAddress: REMOTE_ADDR,
			headers: {
				cookie,
				"content-type": "application/octet-stream",
				"x-filename": "evil.exe",
			},
			payload: Buffer.from("x"),
		})
		expect(ext.statusCode).toBe(415)

		const noName = await built.app.inject({
			method: "PUT",
			url: `/api/tags/${id}/images/image`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie, "content-type": "application/octet-stream" },
			payload: Buffer.from("x"),
		})
		expect(noName.statusCode).toBe(400)

		const badType = await built.app.inject({
			method: "PUT",
			url: `/api/tags/${id}/images/image`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie, "content-type": "image/png", "x-filename": "a.png" },
			payload: Buffer.from("x"),
		})
		expect(badType.statusCode).toBe(415)
	})

	test("the routes require a session and reject traversal ids", async () => {
		const id = seedTag(built, "auth")
		const anon = await built.app.inject({
			method: "GET",
			url: `/api/tags/${id}/images/image`,
			remoteAddress: REMOTE_ADDR,
		})
		expect(anon.statusCode).toBe(401)

		const traversal = await built.app.inject({
			method: "GET",
			url: "/api/tags/..%2Fapp.sqlite/images/image",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(traversal.statusCode).toBe(400)
	})

	test("upload resolves into the versioned tag folder", async () => {
		const id = seedTag(built, "folder")
		await built.app.inject({
			method: "PUT",
			url: `/api/tags/${id}/images/image`,
			remoteAddress: REMOTE_ADDR,
			headers: {
				cookie,
				"content-type": "application/octet-stream",
				"x-filename": "logo.png",
			},
			payload: Buffer.from("logo-bytes"),
		})
		const imagePath = await built.app.tagService.resolveImagePath(id)
		expect(imagePath).toBeTruthy()
		expect(existsSync(imagePath ?? "")).toBe(true)
		expect(imagePath?.startsWith(built.storagePaths.latest.tag(id))).toBe(true)
	})

	test("thumb renders the uploaded art through the shared pipeline", async () => {
		const id = seedTag(built, "thumb-render")
		const png = await sharp({
			create: {
				width: 8,
				height: 8,
				channels: 3,
				background: { r: 200, g: 60, b: 60 },
			},
		})
			.png()
			.toBuffer()

		const put = await built.app.inject({
			method: "PUT",
			url: `/api/tags/${id}/images/image`,
			remoteAddress: REMOTE_ADDR,
			headers: {
				cookie,
				"content-type": "application/octet-stream",
				"x-filename": "art.png",
			},
			payload: png,
		})
		expect(put.statusCode).toBe(201)

		const thumb = await built.app.inject({
			method: "GET",
			url: `/api/tags/${id}/thumb/image`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(thumb.statusCode).toBe(200)
		expect(thumb.headers["content-type"]).toBe("image/avif")
		const body = thumb.rawPayload
		expect(body.length).toBeGreaterThan(0)
		// AVIF files start with the ftyp box signature.
		expect(body.subarray(4, 12).toString("latin1")).toBe("ftypavif")
	})
})
