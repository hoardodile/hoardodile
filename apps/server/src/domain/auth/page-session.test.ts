import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import sharp from "sharp"
import { loadEnv } from "src/config/env.ts"
import { buildSystemPrefRepository } from "src/domain/prefs/repo.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, beforeEach, expect, test } from "vitest"
import { hashPassword } from "./password.ts"

let built: BuiltServer
let root: string
let resourceId: string
beforeEach(async () => {
	root = mkdtempSync(join(tmpdir(), "hoardodile-auth-test-"))
	const db = openDb(":memory:")
	db.runMigrations()
	db.db
		.insert(schema.auth)
		.values({
			singleton: 1,
			passwordHash: await hashPassword("hunter2"),
			updatedAt: Date.now(),
		})
		.run()
	built = await buildServer({
		env: loadEnv({ NODE_ENV: "test", LOG_LEVEL: "silent", STORAGE_ROOT: root }),
		dbHandles: db,
	})
	await built.app.ready()
	resourceId = (await built.app.resService.create({ name: "Private media" })).id
})
afterEach(async () => {
	await built.close()
	built.db.close()
	rmSync(root, { recursive: true, force: true })
})

async function verify(url = "/auth/login", sessionMode = "page") {
	return built.app.inject({
		method: "POST",
		url,
		payload: { password: "hunter2", sessionMode },
	})
}

test("page credentials authenticate HTTP and tRPC without setting cookies", async () => {
	const login = await verify()
	expect(login.statusCode).toBe(200)
	expect(login.headers["set-cookie"]).toBeUndefined()
	const token: string = login.json().sessionToken
	expect(token).toBeTypeOf("string")
	const headers = {
		authorization: `Bearer ${token}`,
		"x-hoardodile-session-mode": "page",
	}
	expect(
		(await built.app.inject({ url: "/auth/status", headers })).json(),
	).toMatchObject({ authenticated: true })
	expect(
		(await built.app.inject({ url: "/trpc/me", headers })).statusCode,
	).toBe(200)
	const media = await built.app.inject({
		url: `/api/resources/${resourceId}/cover?size=original`,
		headers,
	})
	expect(media.statusCode).toBe(404)
})

test("a page request or invalid bearer never falls back to a valid shared cookie", async () => {
	const login = await verify("/auth/login", "cookie")
	const cookie = login.cookies
		.map((entry) => `${entry.name}=${entry.value}`)
		.join("; ")
	for (const headers of [
		{ cookie, "x-hoardodile-session-mode": "page" },
		{ cookie, authorization: "Bearer invalid" },
	]) {
		expect(
			(await built.app.inject({ url: "/auth/status", headers })).json(),
		).toMatchObject({ authenticated: false })
		expect(
			(await built.app.inject({ url: "/trpc/me", headers })).statusCode,
		).toBe(401)
	}
})

test("unlock verifies a password without a live session and does not record another login", async () => {
	await verify()
	const before = built.db.db.select().from(schema.authSignIns).all()
	const bad = await built.app.inject({
		method: "POST",
		url: "/auth/unlock",
		payload: { password: "wrong" },
	})
	expect(bad.statusCode).toBe(401)
	const unlocked = await verify("/auth/unlock")
	expect(unlocked.statusCode).toBe(200)
	expect(unlocked.json().sessionToken).toBeTypeOf("string")
	expect(built.db.db.select().from(schema.authSignIns).all()).toHaveLength(
		before.length,
	)
})

test("read capabilities are bound to one exact native path and cannot authorize writes or tRPC", async () => {
	const login = await verify()
	const headers = { authorization: `Bearer ${login.json().sessionToken}` }
	const path = `/api/resources/${resourceId}/cover`
	const png = await sharp({
		create: {
			width: 20,
			height: 20,
			channels: 3,
			background: { r: 1, g: 2, b: 3 },
		},
	})
		.png()
		.toBuffer()
	const upload = await built.app.inject({
		method: "PUT",
		url: path,
		headers: {
			...headers,
			"x-filename": "cover.png",
			"content-type": "application/octet-stream",
		},
		payload: png,
	})
	expect(upload.statusCode).toBe(201)
	const issued = await built.app.inject({
		method: "POST",
		url: "/auth/read-tokens",
		headers,
		payload: { paths: [path] },
	})
	expect(issued.statusCode).toBe(200)
	const token: string = issued.json()[0].sealed
	const media = await built.app.inject({
		url: `${path}?size=original&readToken=${token}`,
	})
	expect(media.statusCode, media.body).toBe(200)
	expect(media.rawPayload).toEqual(png)
	const range = await built.app.inject({
		url: `${path}?size=original&readToken=${token}`,
		headers: { range: "bytes=0-9" },
	})
	expect(range.statusCode).toBe(206)
	expect(range.rawPayload).toHaveLength(10)
	expect(
		(
			await built.app.inject({
				url: `/api/resources/other/cover?readToken=${token}`,
			})
		).statusCode,
	).toBe(401)
	expect(
		(
			await built.app.inject({
				method: "PUT",
				url: `${path}?readToken=${token}`,
				headers: { "content-type": "application/octet-stream" },
				payload: "no",
			})
		).statusCode,
	).toBe(401)
	expect(
		(await built.app.inject({ url: `/trpc/me?readToken=${token}` })).statusCode,
	).toBe(401)
	expect(
		(
			await built.app.inject({
				method: "POST",
				url: "/auth/read-tokens",
				headers,
				payload: { paths: ["/trpc/me"] },
			})
		).statusCode,
	).toBe(400)
})

test("only the environment TTL controls new sessions, and bearer refresh does not write a cookie", async () => {
	buildSystemPrefRepository(built.db.db).upsert(
		"auth.sessionIdleTimeoutSeconds",
		"60",
		Date.now(),
	)
	const login = await verify()
	const session = await built.app.sessions.read(login.json().sessionToken)
	expect(session && session.expiresAt - session.createdAt).toBe(
		built.app.env.SESSION_TTL_SECONDS * 1000,
	)
	const old = await built.app.sessions.create(120, Date.now() - 80_000)
	const refreshed = await built.app.inject({
		url: "/auth/status",
		headers: { authorization: `Bearer ${old.sealed}` },
	})
	expect(refreshed.headers["x-hoardodile-session"]).toBeTypeOf("string")
	expect(refreshed.headers["set-cookie"]).toBeUndefined()
})
