import { mkdtempSync, rmSync } from "node:fs"
import { readdir } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { Readable } from "node:stream"
import sharp from "sharp"
import { loadEnv } from "src/config/env.ts"
import { hashPassword } from "src/domain/auth/password.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { generateUploadPreview } from "src/infra/thumb/preview.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"

const REMOTE_ADDR = "127.0.0.1"

// Count how often previews are actually rendered, so cache-hit requests
// can be proven to skip generation.
vi.mock("src/infra/thumb/preview.ts", async (importOriginal) => {
	const actual =
		await importOriginal<typeof import("src/infra/thumb/preview.ts")>()
	return {
		...actual,
		generateUploadPreview: vi.fn(actual.generateUploadPreview),
	}
})

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
	const cookie = res.headers["set-cookie"]
	if (typeof cookie !== "string") throw new Error("login failed")
	return cookie.split(";")[0]!
}

describe("upload staged previews", () => {
	let root: string
	let built: BuiltServer
	let cookie: string

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "app-preview-route-"))
		built = await bootstrap(root)
		cookie = await login(built)
	})

	afterEach(async () => {
		vi.clearAllMocks()
		rmSync(root, { recursive: true, force: true })
	})

	async function stagePng(): Promise<string> {
		const png = await sharp({
			create: {
				width: 64,
				height: 48,
				channels: 3,
				background: { r: 200, g: 100, b: 50 },
			},
		})
			.png()
			.toBuffer()
		const { fileId } = await built.app.resUploads.stageSingleFile(
			"photo.png",
			Readable.from(png),
		)
		return fileId
	}

	function previewCacheFiles(fileId: string): Promise<string[]> {
		const cacheDir = join(built.storagePaths.local.tmp(), "upload-previews")
		return readdir(cacheDir)
			.then((names) =>
				names
					.filter((n) => n.startsWith(`${fileId}.`))
					.map((n) => join(cacheDir, n)),
			)
			.catch(() => [])
	}

	test("first request renders and caches, later requests reuse the cache", async () => {
		const fileId = await stagePng()
		const url = `/api/uploads/staged/${fileId}/preview`

		const first = await built.app.inject({
			method: "GET",
			url,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(first.statusCode).toBe(200)
		expect(first.headers["content-type"]).toMatch(/^image\//)
		expect(vi.mocked(generateUploadPreview)).toHaveBeenCalledTimes(1)

		// The rendered preview is cached under the staged file's id.
		const cached = await previewCacheFiles(fileId)
		expect(cached.length).toBe(1)

		// A second (e.g. reorder-triggered) request hits the cache — no
		// re-render, same bytes.
		const second = await built.app.inject({
			method: "GET",
			url,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(second.statusCode).toBe(200)
		expect(vi.mocked(generateUploadPreview)).toHaveBeenCalledTimes(1)
		expect(
			Buffer.from(second.rawPayload).equals(Buffer.from(first.rawPayload)),
		).toBe(true)
	})

	test("discarding the staged file drops its cached previews", async () => {
		const fileId = await stagePng()
		await built.app.inject({
			method: "GET",
			url: `/api/uploads/staged/${fileId}/preview`,
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect((await previewCacheFiles(fileId)).length).toBe(1)

		const removed = await built.app.resUploads.discardStagedFile(fileId)
		expect(removed).toBe(true)
		expect((await previewCacheFiles(fileId)).length).toBe(0)
	})

	test("unknown staged files answer 404", async () => {
		const res = await built.app.inject({
			method: "GET",
			url: "/api/uploads/staged/00000000-0000-0000-0000-000000000099/preview",
			remoteAddress: REMOTE_ADDR,
			headers: { cookie },
		})
		expect(res.statusCode).toBe(404)
	})
})
