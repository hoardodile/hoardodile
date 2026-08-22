import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadEnv } from "src/config/env.ts"
import { hashPassword } from "src/domain/auth/password.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"

const REMOTE_ADDR = "127.0.0.1"

/** Minimal 1×1 transparent PNG (sRGB, not greyscale+alpha). */
const TINY_PNG = Buffer.from(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAACXBIWXMAAAPoAAAD6AG1e1JrAAAADUlEQVQImWNgYGBgAAAABQABh6FO1AAAAABJRU5ErkJggg==",
	"base64",
)

async function bootstrap(storageRoot: string): Promise<BuiltServer> {
	const env = loadEnv({
		NODE_ENV: "test",
		LOG_LEVEL: "silent",
	} satisfies NodeJS.ProcessEnv)
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
	if (typeof line !== "string") throw new Error("no set-cookie header")
	const head = line.split(";")[0]
	if (head === undefined) throw new Error("malformed cookie")
	return head
}

describe("upload previews HTTP", () => {
	let root: string
	let built: BuiltServer
	let cookie: string
	let baseUrl: string

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "app-prev-"))
		built = await bootstrap(root)
		await built.app.ready()
		await built.app.listen({ host: "127.0.0.1", port: 0 })
		cookie = await login(built)

		const address = built.app.server.address()
		if (address === null || typeof address === "string") {
			throw new Error("server did not bind to a port")
		}
		baseUrl = `http://127.0.0.1:${address.port}`
	})

	afterEach(async () => {
		await built.close()
		built.db.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("POST /api/upload-previews with PNG returns image/avif", async () => {
		const form = new FormData()
		form.append(
			"file",
			new Blob([TINY_PNG], { type: "image/png" }),
			"pixel.png",
		)

		const res = await fetch(`${baseUrl}/api/upload-previews`, {
			method: "POST",
			headers: { cookie },
			body: form,
		})

		expect(res.status).toBe(200)
		expect(res.headers.get("content-type")).toBe("image/avif")
		const blob = await res.blob()
		expect(blob.size).toBeGreaterThan(0)
	})

	test("POST /api/upload-previews without file returns 400", async () => {
		const form = new FormData()

		const res = await fetch(`${baseUrl}/api/upload-previews`, {
			method: "POST",
			headers: { cookie },
			body: form,
		})

		expect(res.status).toBe(400)
	})

	test("POST /api/upload-previews with unsupported type returns 400", async () => {
		const form = new FormData()
		form.append(
			"file",
			new Blob([Buffer.from("PDF")], { type: "application/pdf" }),
			"doc.pdf",
		)

		const res = await fetch(`${baseUrl}/api/upload-previews`, {
			method: "POST",
			headers: { cookie },
			body: form,
		})

		expect(res.status).toBe(400)
	})

	test("POST /api/upload-previews without session is rejected", async () => {
		const form = new FormData()
		form.append(
			"file",
			new Blob([TINY_PNG], { type: "image/png" }),
			"pixel.png",
		)

		const res = await fetch(`${baseUrl}/api/upload-previews`, {
			method: "POST",
			body: form,
		})

		expect(res.status).toBeGreaterThanOrEqual(400)
	})

	test("POST /api/upload-previews with non-multipart returns 415", async () => {
		const res = await fetch(`${baseUrl}/api/upload-previews`, {
			method: "POST",
			headers: { cookie, "content-type": "image/png" },
			body: TINY_PNG,
		})

		expect(res.status).toBe(415)
	})
})
