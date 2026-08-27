import { randomBytes } from "node:crypto"
import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	readdirSync,
	readFileSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { buffer } from "node:stream/consumers"
import {
	createNextVersion,
	ensureBootstrapVersion,
	writeActiveVersion,
} from "@hoardodile/host/hoard"
import { loadEnv } from "src/config/env.ts"
import { hashPassword } from "src/domain/auth/password.ts"
import { deleteAuthRow } from "src/domain/auth/repo.ts"
import { readPendingRestoreMarker } from "src/domain/backup/marker.ts"
import { createBackupService } from "src/domain/backup/service.ts"
import { createVersionService } from "src/domain/version/service.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { createDeferred } from "src/infra/runtime-context.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { stageViewCloneDb } from "src/infra/storage/version-view.ts"
import { afterEach, beforeEach, describe, expect, test, vi } from "vitest"
import yazl from "yazl"
import { type BuiltServer, buildServer } from "./server.ts"

async function bootstrap(): Promise<BuiltServer> {
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
	return buildServer({ env, dbHandles: db })
}

/** @throws when `value` is not a string. */
function assertString(value: unknown): asserts value is string {
	if (typeof value !== "string") {
		throw new Error(`expected string, got ${typeof value}`)
	}
}

type TrpcEnvelope<T> = { result: { data: T } }

/** @throws when `value` is not a tRPC `{ result: { data } }` envelope. */
function assertTrpcEnvelope<T>(
	value: unknown,
): asserts value is TrpcEnvelope<T> {
	if (
		value === null ||
		typeof value !== "object" ||
		!("result" in value) ||
		value.result === null ||
		typeof value.result !== "object" ||
		!("data" in value.result)
	) {
		throw new Error("expected tRPC { result: { data } } envelope")
	}
}

function firstSetCookie(header: string | string[] | undefined): string {
	const line = Array.isArray(header) ? header[0] : header
	assertString(line)
	return line
}

describe("server", () => {
	let built: BuiltServer
	let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined
	let consoleInfoSpy: ReturnType<typeof vi.spyOn> | undefined
	beforeEach(async () => {
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
		built = await bootstrap()
		await built.app.ready()
	})
	afterEach(async () => {
		await built.close()
		built.db.close()
		consoleWarnSpy?.mockRestore()
		consoleInfoSpy?.mockRestore()
	})

	test("/health is public and returns ok", async () => {
		const res = await built.app.inject({
			method: "GET",
			url: "/health",
			remoteAddress: "127.0.0.1",
		})
		expect(res.statusCode).toBe(200)
		expect(res.json()).toEqual({ ok: true })
	})

	test("POST /api/internal/shutdown is 401 when no token is configured", async () => {
		const res = await built.app.inject({
			method: "POST",
			url: "/api/internal/shutdown",
			remoteAddress: "127.0.0.1",
			headers: { "x-shutdown-token": "anything" },
		})
		expect(res.statusCode).toBe(401)
		expect(res.json()).toEqual({ ok: false })
		const health = await built.app.inject({
			method: "GET",
			url: "/health",
			remoteAddress: "127.0.0.1",
		})
		expect(health.statusCode).toBe(200)
	})

	test("login sets an HttpOnly SameSite=Strict cookie and authed tRPC call succeeds", async () => {
		const login = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			remoteAddress: "127.0.0.1",
			payload: { password: "hunter2" },
		})
		expect(login.statusCode).toBe(200)
		expect(login.json()).toEqual({ authenticated: true, configured: true })

		const cookieLine = firstSetCookie(login.headers["set-cookie"])
		expect(cookieLine).toMatch(/HttpOnly/i)
		expect(cookieLine).toMatch(/SameSite=Strict/i)
		expect(cookieLine).toMatch(/app_session=/)

		const headerPart = cookieLine.split(";")[0]
		assertString(headerPart)

		const me = await built.app.inject({
			method: "GET",
			url: "/trpc/me",
			remoteAddress: "127.0.0.1",
			headers: { cookie: headerPart },
		})
		expect(me.statusCode).toBe(200)
		const body = me.json()
		assertTrpcEnvelope<{ authenticated: boolean }>(body)
		expect(body.result.data.authenticated).toBe(true)
	})

	test("tRPC authed procedure returns 401 without a valid session", async () => {
		const res = await built.app.inject({
			method: "GET",
			url: "/trpc/me",
			remoteAddress: "127.0.0.1",
		})
		expect(res.statusCode).toBe(401)
	})

	test("tRPC public procedure works without a session", async () => {
		const res = await built.app.inject({
			method: "GET",
			url: "/trpc/ping",
			remoteAddress: "127.0.0.1",
		})
		expect(res.statusCode).toBe(200)
		const body = res.json()
		assertTrpcEnvelope<{ ok: boolean }>(body)
		expect(body.result.data.ok).toBe(true)
	})

	// Bulk "only selected" listing goes through dedicated mutation
	// procedures so the id set rides in the POST body; plain list queries
	// stay GET-only (queries sent as POST are rejected with 405).
	test("byIds card listing is a POST mutation; plain queries reject POST", async () => {
		const byIds = await built.app.inject({
			method: "POST",
			url: "/trpc/resource.listCardsByIds?batch=1",
			remoteAddress: "127.0.0.1",
			headers: { "content-type": "application/json" },
			payload: JSON.stringify({ "0": { ids: ["some-id"] } }),
		})
		// authedProcedure: transport accepted the POST, auth rejected it.
		expect(byIds.statusCode).toBe(401)

		const postQuery = await built.app.inject({
			method: "POST",
			url: "/trpc/ping?batch=1",
			remoteAddress: "127.0.0.1",
			headers: { "content-type": "application/json" },
			payload: JSON.stringify({ "0": {} }),
		})
		expect(postQuery.statusCode).toBe(405)
	})

	// Bulk id-array lookups are POST mutations for the same reason as
	// listCardsByIds above: GET URLs hit Node's 16 KB header cap.
	test("bulk id-array lookups are POST mutations", async () => {
		const cases: ReadonlyArray<readonly [string, unknown]> = [
			["character.byIds", { ids: ["some-id"] }],
			["character.listCharactershipsForCharacters", { charIds: ["some-id"] }],
		]
		for (const [procedure, input] of cases) {
			const res = await built.app.inject({
				method: "POST",
				url: `/trpc/${procedure}?batch=1`,
				remoteAddress: "127.0.0.1",
				headers: { "content-type": "application/json" },
				payload: JSON.stringify({ "0": input }),
			})
			// authedProcedure: transport accepted the POST, auth rejected it.
			expect(res.statusCode).toBe(401)

			const get = await built.app.inject({
				method: "GET",
				url: `/trpc/${procedure}?batch=1&input=${encodeURIComponent(JSON.stringify({ "0": { json: input } }))}`,
				remoteAddress: "127.0.0.1",
			})
			// Mutations reject GET with 405.
			expect(get.statusCode).toBe(405)
		}
	})

	test("login with the wrong password returns 401", async () => {
		const res = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			remoteAddress: "127.0.0.1",
			payload: { password: "wrong" },
		})
		expect(res.statusCode).toBe(401)
	})

	test("path token authenticates GET file routes, even with a query string", async () => {
		const { sealed } = await built.app.sessions.createToken(86_400, {
			kind: "res",
			id: "res-1",
		})
		const res = await built.app.inject({
			method: "GET",
			url: `/api/resources/res-1/files/${sealed}/foo.png?download=1`,
			remoteAddress: "127.0.0.1",
		})
		// The resource does not exist, but the request must pass auth
		// (a missing token or cookie would yield 401 instead).
		expect(res.statusCode).not.toBe(401)
	})

	test("path token scoped to one resource is rejected for another", async () => {
		const { sealed } = await built.app.sessions.createToken(86_400, {
			kind: "res",
			id: "res-1",
		})
		const res = await built.app.inject({
			method: "GET",
			url: `/api/resources/res-2/files/${sealed}/foo.png`,
			remoteAddress: "127.0.0.1",
		})
		expect(res.statusCode).toBe(401)
	})

	test("path token in the query string is not honoured on GET routes", async () => {
		const { sealed } = await built.app.sessions.createToken(86_400, {
			kind: "res",
			id: "res-1",
		})
		const res = await built.app.inject({
			method: "GET",
			url: `/api/cache/trash?x=/files/${sealed}/`,
			remoteAddress: "127.0.0.1",
		})
		expect(res.statusCode).toBe(401)
	})

	test("path token in the query string is not honoured on write routes", async () => {
		const { sealed } = await built.app.sessions.createToken(86_400, {
			kind: "res",
			id: "res-1",
		})
		for (const url of [
			`/api/plugin-upload?x=/files/${sealed}/`,
			`/api/resources/res-1/cover?x=/frame/${sealed}/`,
		]) {
			const res = await built.app.inject({
				method: url.includes("cover") ? "PUT" : "POST",
				url,
				remoteAddress: "127.0.0.1",
			})
			expect(res.statusCode, url).toBe(401)
		}
	})

	test("logout instructs the browser to clear the session cookie", async () => {
		const login = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			remoteAddress: "127.0.0.1",
			payload: { password: "hunter2" },
		})
		const cookieLine = firstSetCookie(login.headers["set-cookie"])
		const headerPart = cookieLine.split(";")[0]
		assertString(headerPart)

		const logout = await built.app.inject({
			method: "POST",
			url: "/auth/logout",
			remoteAddress: "127.0.0.1",
			headers: { cookie: headerPart },
		})
		expect(logout.statusCode).toBe(200)
		// Stateless cookie design: logout's only effect is the clearing
		// Set-Cookie header sent back to the browser. The cookie value
		// itself remains cryptographically valid until its TTL expires --
		// any client that ignores the clear instruction (or replays a
		// captured cookie) keeps access until then. Acceptable for the
		// single-user desktop deployment.
		const clearLine = firstSetCookie(logout.headers["set-cookie"])
		expect(clearLine).toMatch(/app_session=/)
		expect(clearLine).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i)
	})

	test("logout works when the frontend sends an empty JSON body", async () => {
		const login = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			remoteAddress: "127.0.0.1",
			payload: { password: "hunter2" },
		})
		const cookieLine = firstSetCookie(login.headers["set-cookie"])
		const headerPart = cookieLine.split(";")[0]
		assertString(headerPart)

		const logout = await built.app.inject({
			method: "POST",
			url: "/auth/logout",
			remoteAddress: "127.0.0.1",
			headers: {
				cookie: headerPart,
				"content-type": "application/json",
			},
			payload: JSON.stringify({}),
		})
		expect(logout.statusCode).toBe(200)
		expect(logout.json()).toEqual({ ok: true })
		const clearLine = firstSetCookie(logout.headers["set-cookie"])
		expect(clearLine).toMatch(/app_session=/)
		expect(clearLine).toMatch(/Expires=Thu, 01 Jan 1970|Max-Age=0/i)
	})
})

describe("web setup and password change", () => {
	async function buildUnconfigured(): Promise<BuiltServer> {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
		} satisfies NodeJS.ProcessEnv)
		const db = openDb(":memory:")
		db.runMigrations()
		return buildServer({ env, dbHandles: db })
	}

	async function loginCookie(
		built: BuiltServer,
		password: string,
	): Promise<string> {
		const login = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			remoteAddress: "127.0.0.1",
			payload: { password },
		})
		expect(login.statusCode).toBe(200)
		const cookieLine = firstSetCookie(login.headers["set-cookie"])
		const headerPart = cookieLine.split(";")[0]
		assertString(headerPart)
		return headerPart
	}

	test("status reports unconfigured on a fresh server and login stays locked", async () => {
		const built = await buildUnconfigured()
		try {
			const status = await built.app.inject({
				method: "GET",
				url: "/auth/status",
				remoteAddress: "127.0.0.1",
			})
			expect(status.statusCode).toBe(200)
			expect(status.json()).toEqual({ authenticated: false, configured: false })

			const login = await built.app.inject({
				method: "POST",
				url: "/auth/login",
				remoteAddress: "127.0.0.1",
				payload: { password: "hunter2" },
			})
			expect(login.statusCode).toBe(401)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("setup claims an unconfigured server; the password then logs in", async () => {
		const built = await buildUnconfigured()
		try {
			const setup = await built.app.inject({
				method: "POST",
				url: "/auth/setup",
				remoteAddress: "127.0.0.1",
				payload: { password: "hunter2" },
			})
			expect(setup.statusCode).toBe(200)
			expect(setup.json()).toEqual({ ok: true })

			const status = await built.app.inject({
				method: "GET",
				url: "/auth/status",
				remoteAddress: "127.0.0.1",
			})
			expect(status.json()).toEqual({ authenticated: false, configured: true })

			const cookie = await loginCookie(built, "hunter2")
			expect(cookie.length).toBeGreaterThan(0)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("a valid session is revoked once the auth row is cleared", async () => {
		const built = await buildUnconfigured()
		try {
			await built.app.inject({
				method: "POST",
				url: "/auth/setup",
				remoteAddress: "127.0.0.1",
				payload: { password: "hunter2" },
			})
			const cookie = await loginCookie(built, "hunter2")

			const before = await built.app.inject({
				method: "GET",
				url: "/auth/status",
				remoteAddress: "127.0.0.1",
				headers: { cookie },
			})
			expect(before.statusCode).toBe(200)
			expect(before.json()).toEqual({
				authenticated: true,
				configured: true,
			})

			deleteAuthRow(built.db.db)

			const after = await built.app.inject({
				method: "GET",
				url: "/auth/status",
				remoteAddress: "127.0.0.1",
				headers: { cookie },
			})
			expect(after.statusCode).toBe(200)
			expect(after.json()).toEqual({
				authenticated: false,
				configured: false,
			})

			// No password path exists while unconfigured; the web UI's
			// only way forward is the setup form.
			const password = await built.app.inject({
				method: "POST",
				url: "/auth/password",
				remoteAddress: "127.0.0.1",
				headers: { cookie },
				payload: {
					currentPassword: "hunter2",
					newPassword: "new-password",
				},
			})
			expect(password.statusCode).toBe(409)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("setup on a configured server is rejected with 409", async () => {
		const built = await buildUnconfigured()
		try {
			await built.app.inject({
				method: "POST",
				url: "/auth/setup",
				remoteAddress: "127.0.0.1",
				payload: { password: "first-password" },
			})
			const second = await built.app.inject({
				method: "POST",
				url: "/auth/setup",
				remoteAddress: "127.0.0.1",
				payload: { password: "second-password" },
			})
			expect(second.statusCode).toBe(409)

			// The first password still wins.
			const cookie = await loginCookie(built, "first-password")
			expect(cookie.length).toBeGreaterThan(0)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("setup rejects passwords below the minimum length", async () => {
		const built = await buildUnconfigured()
		try {
			const res = await built.app.inject({
				method: "POST",
				url: "/auth/setup",
				remoteAddress: "127.0.0.1",
				payload: { password: "abc" },
			})
			expect(res.statusCode).toBe(400)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("password change requires a session", async () => {
		const built = await buildUnconfigured()
		try {
			await built.app.inject({
				method: "POST",
				url: "/auth/setup",
				remoteAddress: "127.0.0.1",
				payload: { password: "hunter2" },
			})
			const res = await built.app.inject({
				method: "POST",
				url: "/auth/password",
				remoteAddress: "127.0.0.1",
				payload: { currentPassword: "hunter2", newPassword: "new-password" },
			})
			expect(res.statusCode).toBe(401)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("password change rejects a wrong current password with 403", async () => {
		const built = await buildUnconfigured()
		try {
			await built.app.inject({
				method: "POST",
				url: "/auth/setup",
				remoteAddress: "127.0.0.1",
				payload: { password: "hunter2" },
			})
			const cookie = await loginCookie(built, "hunter2")
			const res = await built.app.inject({
				method: "POST",
				url: "/auth/password",
				remoteAddress: "127.0.0.1",
				headers: { cookie },
				payload: { currentPassword: "wrong", newPassword: "new-password" },
			})
			expect(res.statusCode).toBe(403)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("password change swaps the password; the old one no longer logs in", async () => {
		const built = await buildUnconfigured()
		try {
			await built.app.inject({
				method: "POST",
				url: "/auth/setup",
				remoteAddress: "127.0.0.1",
				payload: { password: "hunter2" },
			})
			const cookie = await loginCookie(built, "hunter2")
			const res = await built.app.inject({
				method: "POST",
				url: "/auth/password",
				remoteAddress: "127.0.0.1",
				headers: { cookie },
				payload: { currentPassword: "hunter2", newPassword: "new-password" },
			})
			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ ok: true })

			const oldLogin = await built.app.inject({
				method: "POST",
				url: "/auth/login",
				remoteAddress: "127.0.0.1",
				payload: { password: "hunter2" },
			})
			expect(oldLogin.statusCode).toBe(401)
			const newLogin = await built.app.inject({
				method: "POST",
				url: "/auth/login",
				remoteAddress: "127.0.0.1",
				payload: { password: "new-password" },
			})
			expect(newLogin.statusCode).toBe(200)
		} finally {
			await built.close()
			built.db.close()
		}
	})
})

describe("buildServer lifecycle (9a)", () => {
	let root: string
	let dbFilePath: string
	let paths: ReturnType<typeof createStoragePaths>

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-lifecycle-"))
		paths = createStoragePaths({ root })
		dbFilePath = paths.runtimeDb()
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	test("a staged restore is applied automatically on the next buildServer (no child process)", async () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
			DATABASE_URL: dbFilePath,
		} satisfies NodeJS.ProcessEnv)

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: number,
		) => {
			throw new Error(`process.exit(${code}) must not be called`)
		}) as typeof process.exit)

		// First server owns its DB (no handles passed).
		const onContextReloaded = vi.fn()
		const built1 = await buildServer({
			env,
			onContextReloaded,
		})
		await built1.app.ready()

		// Seed auth data so we can tell the first DB from the swapped one.
		const passwordHash = await hashPassword("hunter2")
		built1.db.db
			.insert(schema.auth)
			.values({ singleton: 1, passwordHash, updatedAt: 1 })
			.run()

		// Take a snapshot of state #1, mutate live DB, then stage a restore
		// of the earlier snapshot. After restart the mutation must be gone.
		const svc = createBackupService({
			db: built1.db,
			paths: built1.storagePaths,
			dbFilePath,
		})
		const snap = await svc.create()

		built1.db.db
			.update(schema.auth)
			.set({ passwordHash: "tainted", updatedAt: 999 })
			.run()

		await svc.prepareRestore(snap.fileName)
		expect(readPendingRestoreMarker(paths)?.sourceName).toBe(snap.fileName)

		// Simulate the tRPC restore hook: close the server, then build a
		// fresh one. `applyPendingRestore` runs at the top of `buildServer`
		// before the DB is opened.
		await built1.close()
		const built2 = await buildServer({ env })
		await built2.app.ready()

		// Marker cleared -> applyPendingRestore ran.
		expect(readPendingRestoreMarker(paths)).toBeUndefined()
		// Previous (tainted) DB was preserved in local/trash/.
		const trashEntries = existsSync(paths.local.trash())
			? readdirSync(paths.local.trash())
			: []
		expect(trashEntries.length).toBeGreaterThan(0)
		// The restore brought back the snapshot's data but preserved the
		// current auth row: the tainted hash survives, the snapshot's is
		// never adopted.
		const rows = built2.db.db.select().from(schema.auth).all()
		expect(rows).toHaveLength(1)
		expect(rows[0]?.passwordHash).toBe("tainted")
		expect(rows[0]?.updatedAt).toBe(999)

		// No child process was ever spawned (we only touched `buildServer`).
		expect(onContextReloaded).not.toHaveBeenCalled()
		expect(exitSpy).not.toHaveBeenCalled()

		await built2.close()
		exitSpy.mockRestore()
	})

	test("storage context is hot-reloaded in-process on restore signal", async () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
			DATABASE_URL: dbFilePath,
		} satisfies NodeJS.ProcessEnv)

		const exitSpy = vi.spyOn(process, "exit").mockImplementation(((
			code?: number,
		) => {
			throw new Error(`process.exit(${code}) must not be called`)
		}) as typeof process.exit)

		let resolveReloaded: (() => void) | undefined
		const reloadPromise = new Promise<void>((r) => {
			resolveReloaded = r
		})
		const onContextReloaded = vi.fn(() => {
			resolveReloaded?.()
		})
		const built = await buildServer({
			env,
			onContextReloaded,
		})
		await built.app.ready()

		// Seed auth data so we can tell the first DB from the swapped one.
		const passwordHash = await hashPassword("hunter2")
		built.db.db
			.insert(schema.auth)
			.values({ singleton: 1, passwordHash, updatedAt: 1 })
			.run()

		// Take a snapshot, mutate live DB, stage restore, then emit the
		// same signal the backup router emits.
		const svc = createBackupService({
			db: built.db,
			paths: built.storagePaths,
			dbFilePath,
		})
		const snap = await svc.create()

		built.db.db
			.update(schema.auth)
			.set({ passwordHash: "tainted", updatedAt: 999 })
			.run()

		await svc.prepareRestore(snap.fileName)
		const pidBefore = process.pid

		built.app.signals.emit("backup.restoreRequested", undefined)
		await reloadPromise

		// Same process, but the DB was swapped.
		expect(process.pid).toBe(pidBefore)
		expect(onContextReloaded).toHaveBeenCalledTimes(1)
		expect(readPendingRestoreMarker(paths)).toBeUndefined()

		// The restore preserved the current auth row (the tainted hash)
		// instead of adopting the snapshot's.
		const rows = built.db.db.select().from(schema.auth).all()
		expect(rows).toHaveLength(1)
		expect(rows[0]?.passwordHash).toBe("tainted")
		expect(rows[0]?.updatedAt).toBe(999)

		// Server is still listening and serving requests.
		const health = await built.app.inject({
			method: "GET",
			url: "/health",
			remoteAddress: "127.0.0.1",
		})
		expect(health.statusCode).toBe(200)

		await built.close()
		exitSpy.mockRestore()
	})

	test("requests are queued during storage context reload", async () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
			DATABASE_URL: dbFilePath,
		} satisfies NodeJS.ProcessEnv)

		const built = await buildServer({ env })
		await built.app.ready()

		// Manually enter draining state with a controlled gate.
		const gate = createDeferred<void>()
		built.app.isDraining = true
		built.app.reloadGate = gate

		// Send a request while draining; it should not complete until the gate resolves.
		const responsePromise = built.app.inject({
			method: "GET",
			url: "/health",
			remoteAddress: "127.0.0.1",
		})

		await new Promise((resolve) => setImmediate(resolve))
		let completed = false
		responsePromise.then(
			() => {
				completed = true
			},
			() => {
				completed = true
			},
		)
		expect(completed).toBe(false)

		gate.resolve()
		const res = await responsePromise
		expect(res.statusCode).toBe(200)
		expect(res.json()).toEqual({ ok: true })

		await built.close()
	})

	test("SSE /api/events is excluded from draining", async () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
			DATABASE_URL: dbFilePath,
		} satisfies NodeJS.ProcessEnv)

		const built = await buildServer({ env })
		await built.app.listen({ host: "127.0.0.1", port: 0 })
		const address = built.app.server.address()
		const baseUrl =
			typeof address === "string"
				? address
				: `http://127.0.0.1:${address?.port}`

		// Open an SSE connection. It should not count as an in-flight request.
		const controller = new AbortController()
		const ssePromise = fetch(`${baseUrl}/api/events`, {
			signal: controller.signal,
		})

		// Give the server a chance to enter the SSE handler.
		await new Promise((resolve) => setTimeout(resolve, 50))
		expect(built.app.inflightRequests).toBe(0)

		// Enter draining with a gate that will never resolve on its own.
		const gate = createDeferred<void>()
		built.app.isDraining = true
		built.app.reloadGate = gate

		// A normal request should be queued, not rejected.
		const healthPromise = built.app.inject({
			method: "GET",
			url: "/health",
			remoteAddress: "127.0.0.1",
		})
		await new Promise((resolve) => setImmediate(resolve))
		let healthCompleted = false
		healthPromise.then(
			() => {
				healthCompleted = true
			},
			() => {
				healthCompleted = true
			},
		)
		expect(healthCompleted).toBe(false)

		// The SSE connection did not block draining: inflightRequests is still 0.
		expect(built.app.inflightRequests).toBe(0)

		// Resolve the gate and finish.
		gate.resolve()
		const health = await healthPromise
		expect(health.statusCode).toBe(200)

		controller.abort()
		try {
			await ssePromise
		} catch {
			// Aborting the fetch is expected.
		}
		await built.close()
	})

	test("graceful close releases the DB lock and stops Fastify", async () => {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
			DATABASE_URL: dbFilePath,
		} satisfies NodeJS.ProcessEnv)

		const built = await buildServer({ env })
		await built.app.listen({ host: "127.0.0.1", port: 0 })

		await built.close()

		// Fastify instance is closed: a further inject rejects.
		await expect(
			built.app.inject({ method: "GET", url: "/health" }),
		).rejects.toThrow()

		// DB file is unlocked: re-opening succeeds and integrity is intact.
		const reopened = openDb(dbFilePath)
		try {
			expect(reopened.integrityCheck()).toBe(true)
		} finally {
			reopened.close()
		}
	})

	test("webRoot serves index.html at / and falls back to it on unknown paths", async () => {
		const webRoot = join(root, "web-dist")
		mkdirSync(webRoot, { recursive: true })
		const indexHtml =
			"<!doctype html><html><body data-testid=spa>ok</body></html>"
		writeFileSync(join(webRoot, "index.html"), indexHtml, "utf8")
		writeFileSync(join(webRoot, "app.js"), "// static asset", "utf8")

		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
			DATABASE_URL: dbFilePath,
		} satisfies NodeJS.ProcessEnv)

		const built = await buildServer({
			env,
			webRoot,
		})
		try {
			await built.app.ready()

			const rootRes = await built.app.inject({
				method: "GET",
				url: "/",
				remoteAddress: "127.0.0.1",
			})
			expect(rootRes.statusCode).toBe(200)
			expect(rootRes.body).toContain("data-testid=spa")
			expect(rootRes.headers["content-security-policy"]).toBe(
				"frame-ancestors 'self'",
			)

			const assetRes = await built.app.inject({
				method: "GET",
				url: "/app.js",
				remoteAddress: "127.0.0.1",
			})
			expect(assetRes.statusCode).toBe(200)
			expect(assetRes.body).toContain("static asset")

			const deepRes = await built.app.inject({
				method: "GET",
				url: "/resources/123/edit",
				remoteAddress: "127.0.0.1",
			})
			expect(deepRes.statusCode).toBe(200)
			expect(deepRes.body).toContain("data-testid=spa")
			expect(deepRes.headers["content-security-policy"]).toBe(
				"frame-ancestors 'self'",
			)

			// API/trpc routes are unaffected by the SPA fallback.
			const health = await built.app.inject({
				method: "GET",
				url: "/health",
				remoteAddress: "127.0.0.1",
			})
			expect(health.statusCode).toBe(200)
			expect(health.json()).toEqual({ ok: true })
		} finally {
			await built.close()
		}
	})
})

describe("plugin asset security headers", () => {
	const PLUGIN_ID = "11111111-1111-4111-8111-111111111111"
	let root: string
	let built: BuiltServer
	let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined
	let consoleInfoSpy: ReturnType<typeof vi.spyOn> | undefined

	beforeEach(async () => {
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
		root = mkdtempSync(join(tmpdir(), "plugin-asset-headers-"))
		const pluginDir = join(root, "versions", "1", "plugins", PLUGIN_ID)
		mkdirSync(pluginDir, { recursive: true })
		writeFileSync(
			join(pluginDir, "manifest.json"),
			JSON.stringify({
				id: PLUGIN_ID,
				name: "header-test",
				description: "header test fixture",
				version: "0.0.0",
				permissions: {},
			}),
		)
		writeFileSync(
			join(pluginDir, "index.html"),
			"<!doctype html><html><body>plugin</body></html>",
		)
		writeFileSync(join(pluginDir, "main.js"), "export default {}\n")
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		} satisfies NodeJS.ProcessEnv)
		built = await buildServer({ env })
		await built.app.ready()
	})

	afterEach(async () => {
		await built.close()
		rmSync(root, { recursive: true, force: true })
		consoleWarnSpy?.mockRestore()
		consoleInfoSpy?.mockRestore()
	})

	test("plugin HTML pages are served with a CSP sandbox and frame-ancestors", async () => {
		const res = await built.app.inject({
			method: "GET",
			url: `/api/plugins/${PLUGIN_ID}/index.html`,
			remoteAddress: "127.0.0.1",
		})
		expect(res.statusCode).toBe(200)
		const csp = res.headers["content-security-policy"]
		expect(csp).toContain("sandbox allow-scripts allow-forms allow-downloads")
		expect(csp).toContain("frame-ancestors 'self'")
	})

	test("plugin non-HTML assets carry no CSP but keep nosniff", async () => {
		const res = await built.app.inject({
			method: "GET",
			url: `/api/plugins/${PLUGIN_ID}/main.js`,
			remoteAddress: "127.0.0.1",
		})
		expect(res.statusCode).toBe(200)
		expect(res.headers["content-security-policy"]).toBeUndefined()
		expect(res.headers["x-content-type-options"]).toBe("nosniff")
	})

	test("the `vault` subdirectory is never served by the plugin-asset route", async () => {
		const vaultDir = join(root, "versions", "1", "plugins", PLUGIN_ID, "vault")
		mkdirSync(vaultDir, { recursive: true })
		writeFileSync(join(vaultDir, "runtime.mjs"), "export const x = 1\n")
		const res = await built.app.inject({
			method: "GET",
			url: `/api/plugins/${PLUGIN_ID}/vault/runtime.mjs`,
			remoteAddress: "127.0.0.1",
		})
		expect(res.statusCode).toBe(403)
	})

	test("GET /api/plugin-assets/:id/:token/* validates the token scope", async () => {
		const vaultDir = join(root, "versions", "1", "plugins", PLUGIN_ID, "vault")
		mkdirSync(vaultDir, { recursive: true })
		writeFileSync(join(vaultDir, "runtime.mjs"), "export const x = 1\n")
		const token = await built.app.sessions.createToken(86_400, {
			kind: "plugin",
			id: PLUGIN_ID,
		})
		const res = await built.app.inject({
			method: "GET",
			url: `/api/plugin-assets/${PLUGIN_ID}/${token.sealed}/runtime.mjs`,
			remoteAddress: "127.0.0.1",
		})
		expect(res.statusCode).toBe(200)
		expect(res.headers["content-type"]).toBe("text/javascript")
		expect(res.headers["x-content-type-options"]).toBe("nosniff")
		expect(res.headers["cache-control"]).toBe("private, no-cache")
		// A res-scoped token must not open the plugin vault.
		const wrongToken = await built.app.sessions.createToken(86_400, {
			kind: "res",
			id: PLUGIN_ID,
		})
		const wrong = await built.app.inject({
			method: "GET",
			url: `/api/plugin-assets/${PLUGIN_ID}/${wrongToken.sealed}/runtime.mjs`,
			remoteAddress: "127.0.0.1",
		})
		expect(wrong.statusCode).toBe(401)
	})

	test("nested vault paths keep every segment (no preHandler truncation)", async () => {
		const vaultDir = join(root, "versions", "1", "plugins", PLUGIN_ID, "vault")
		mkdirSync(join(vaultDir, "runtime"), { recursive: true })
		writeFileSync(join(vaultDir, "runtime", "live2d.min.js"), "window.L2D=1;\n")
		const token = await built.app.sessions.createToken(86_400, {
			kind: "plugin",
			id: PLUGIN_ID,
		})
		const res = await built.app.inject({
			method: "GET",
			url: `/api/plugin-assets/${PLUGIN_ID}/${token.sealed}/runtime/live2d.min.js`,
			remoteAddress: "127.0.0.1",
		})
		expect(res.statusCode).toBe(200)
		expect(res.headers["content-type"]).toBe("text/javascript")
		expect(res.body).toBe("window.L2D=1;\n")
	})
})

describe("plugin seeding", () => {
	const PLUGIN_ID = "22222222-2222-4222-8222-222222222222"
	let root: string
	let built: BuiltServer
	let env: ReturnType<typeof loadEnv>
	let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined
	let consoleInfoSpy: ReturnType<typeof vi.spyOn> | undefined

	beforeEach(async () => {
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
		root = mkdtempSync(join(tmpdir(), "plugin-seed-"))
		const bundledDir = join(root, "bundled")
		mkdirSync(bundledDir, { recursive: true })
		writeFileSync(
			join(bundledDir, "manifest.json"),
			JSON.stringify({
				id: PLUGIN_ID,
				name: "seed-test",
				description: "seeding fixture",
				version: "0.0.0",
				permissions: {},
			}),
		)
		writeFileSync(join(bundledDir, "main.js"), "export default {}\n")
		env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
			SEED_PLUGIN_PATHS: bundledDir,
		} satisfies NodeJS.ProcessEnv)
		built = await buildServer({ env })
		await built.app.ready()
	})

	afterEach(async () => {
		await built.close()
		rmSync(root, { recursive: true, force: true })
		consoleWarnSpy?.mockRestore()
		consoleInfoSpy?.mockRestore()
	})

	test("seed plugin dirs are copied into versions/<latest>/plugins at boot", async () => {
		const seededDir = join(root, "versions", "1", "plugins", PLUGIN_ID)
		expect(existsSync(join(seededDir, "manifest.json"))).toBe(true)
		expect(existsSync(join(seededDir, "main.js"))).toBe(true)
		expect(existsSync(join(root, "local", "plugins", PLUGIN_ID))).toBe(false)
		// The seeded copy is what the registry serves.
		const res = await built.app.inject({
			method: "GET",
			url: `/api/plugins/${PLUGIN_ID}/main.js`,
			remoteAddress: "127.0.0.1",
		})
		expect(res.statusCode).toBe(200)
	})

	test("listSeedPlugins reports the bundled plugin as installed", () => {
		const seeds = built.app.pluginService.listSeedPlugins()
		expect(seeds).toHaveLength(1)
		expect(seeds[0]).toMatchObject({
			id: PLUGIN_ID,
			installed: true,
			installedVersion: "0.0.0",
			removed: false,
			restorable: false,
		})
	})

	test("uninstall keeps the bundled source and survives a restart", async () => {
		await built.app.pluginService.uninstall(PLUGIN_ID)

		// The bundled original is never deleted.
		expect(existsSync(join(root, "bundled", "manifest.json"))).toBe(true)
		expect(existsSync(join(root, "bundled", "main.js"))).toBe(true)
		// The installed copy is gone and the removal marker recorded.
		expect(existsSync(join(root, "versions", "1", "plugins", PLUGIN_ID))).toBe(
			false,
		)
		const seedRemovals = JSON.parse(
			readFileSync(join(root, "local", "seed-removals.json"), "utf-8"),
		) as { readonly removed: readonly string[] }
		expect(seedRemovals.removed).toContain(PLUGIN_ID)

		// A restart must NOT re-seed the deliberately-removed plugin.
		await built.close()
		built = await buildServer({ env })
		await built.app.ready()
		expect(existsSync(join(root, "versions", "1", "plugins", PLUGIN_ID))).toBe(
			false,
		)
		// And the bundled section still lists it as restorable.
		expect(built.app.pluginService.listSeedPlugins()).toEqual([
			expect.objectContaining({
				id: PLUGIN_ID,
				installed: false,
				removed: true,
				restorable: true,
			}),
		])
	})

	test("restoreSeedPlugin reinstalls the bundled plugin offline", async () => {
		await built.app.pluginService.uninstall(PLUGIN_ID)
		await built.app.pluginService.restoreSeedPlugin(PLUGIN_ID)

		expect(
			existsSync(
				join(root, "versions", "1", "plugins", PLUGIN_ID, "manifest.json"),
			),
		).toBe(true)
		const seedRemovals = JSON.parse(
			readFileSync(join(root, "local", "seed-removals.json"), "utf-8"),
		) as { readonly removed: readonly string[] }
		expect(seedRemovals.removed).not.toContain(PLUGIN_ID)
		expect(built.app.pluginService.listSeedPlugins()).toEqual([
			expect.objectContaining({ id: PLUGIN_ID, installed: true }),
		])
	})

	test("restoreSeedPlugin rejects an id without a bundled source", async () => {
		await expect(
			built.app.pluginService.restoreSeedPlugin(
				"33333333-3333-4333-8333-333333333333",
			),
		).rejects.toThrow("bundled source")
	})

	test("restoreSeedPlugin works across a restart (marker persisted)", async () => {
		await built.app.pluginService.uninstall(PLUGIN_ID)
		await built.close()

		// Reboot: the removal marker survives, so the plugin is not seeded.
		built = await buildServer({ env })
		await built.app.ready()
		expect(built.app.pluginService.listSeedPlugins()).toEqual([
			expect.objectContaining({ id: PLUGIN_ID, removed: true }),
		])

		// Offline restore from the (untouched) bundled original.
		await built.app.pluginService.restoreSeedPlugin(PLUGIN_ID)
		expect(
			existsSync(
				join(root, "versions", "1", "plugins", PLUGIN_ID, "manifest.json"),
			),
		).toBe(true)
		expect(built.app.pluginService.listSeedPlugins()).toEqual([
			expect.objectContaining({ id: PLUGIN_ID, installed: true }),
		])
	})
})

describe("read-only boot does not seed latest plugins", () => {
	const PLUGIN_ID = "22222222-2222-4222-8222-222222222222"
	let root: string
	let built: BuiltServer
	let roDb: ReturnType<typeof openDb>
	let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined

	beforeEach(async () => {
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		root = mkdtempSync(join(tmpdir(), "plugin-ro-seed-"))
		ensureBootstrapVersion(root)
		const liveDbPath = join(root, "app.sqlite")
		const db = openDb(liveDbPath)
		db.runMigrations()
		createNextVersion(root, (dest) => {
			db.vacuumInto(dest)
		})
		writeActiveVersion(root, 1)
		db.close()

		const bundledDir = join(root, "bundled")
		mkdirSync(bundledDir, { recursive: true })
		writeFileSync(
			join(bundledDir, "manifest.json"),
			JSON.stringify({
				id: PLUGIN_ID,
				name: "seed-test",
				description: "seeding fixture",
				version: "0.0.0",
				permissions: {},
			}),
		)
		writeFileSync(join(bundledDir, "main.js"), "export default {}\n")

		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
			SEED_PLUGIN_PATHS: bundledDir,
		} satisfies NodeJS.ProcessEnv)
		const paths = createStoragePaths({
			root,
			activeVersion: 1,
			latestVersion: 2,
		})
		const clonePath = stageViewCloneDb(paths, 1)
		roDb = openDb(clonePath, { readonly: true })
		built = await buildServer({
			env,
			dbHandles: roDb,
			storagePaths: paths,
			readOnly: true,
		})
		await built.app.ready()
	})

	afterEach(async () => {
		await built.close()
		roDb.close()
		consoleWarnSpy?.mockRestore()
		rmSync(root, { recursive: true, force: true })
	})

	test("does not copy seed plugins into the latest version", () => {
		expect(existsSync(join(root, "versions", "2", "plugins", PLUGIN_ID))).toBe(
			false,
		)
		expect(existsSync(join(root, "versions", "1", "plugins", PLUGIN_ID))).toBe(
			false,
		)
	})
})
describe("read-only archive mode", () => {
	let root: string
	let built: BuiltServer
	let roDb: ReturnType<typeof openDb>

	beforeEach(async () => {
		root = mkdtempSync(join(tmpdir(), "app-ro-"))
		ensureBootstrapVersion(root)

		const liveDbPath = join(root, "app.sqlite")
		const db = openDb(liveDbPath)
		db.runMigrations()
		const passwordHash = await hashPassword("hunter2")
		db.db
			.insert(schema.auth)
			.values({ singleton: 1, passwordHash, updatedAt: Date.now() })
			.run()

		// Publish version 2 so version 1 becomes an archive
		const versionSvc = createVersionService({
			db,
			storageRoot: root,
			readOnly: false,
		})
		versionSvc.create()
		versionSvc.switchTo(1)
		db.close()

		// Open a read-only clone of version 1
		const clonePath = stageViewCloneDb(createStoragePaths({ root }), 1)
		roDb = openDb(clonePath, { readonly: true })

		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		})
		const paths = createStoragePaths({
			root,
			activeVersion: 1,
			latestVersion: 2,
		})
		built = await buildServer({
			env,
			dbHandles: roDb,
			storagePaths: paths,
			readOnly: true,
		})
		await built.app.ready()
	})

	afterEach(async () => {
		await built.close()
		roDb.close()
		rmSync(root, { recursive: true, force: true })
	})

	async function loginCookie(): Promise<string> {
		const login = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			remoteAddress: "127.0.0.1",
			payload: { password: "hunter2" },
		})
		expect(login.statusCode).toBe(200)
		const cookieLine = firstSetCookie(login.headers["set-cookie"])
		const headerPart = cookieLine.split(";")[0]
		assertString(headerPart)
		return headerPart
	}

	test("tRPC mutation is blocked with FORBIDDEN", async () => {
		const cookie = await loginCookie()
		// resource.create is a mutation; should be rejected in read-only mode
		const res = await built.app.inject({
			method: "POST",
			url: "/trpc/resource.create",
			remoteAddress: "127.0.0.1",
			headers: { cookie, "content-type": "application/json" },
			payload: JSON.stringify({ json: { name: "should-fail" } }),
		})
		expect(res.statusCode).toBe(403)
		const body = res.json()
		expect(body.error?.message).toMatch(/read-only archive/)
	})

	test("tRPC query remains available", async () => {
		const cookie = await loginCookie()
		const res = await built.app.inject({
			method: "GET",
			url: "/trpc/resource.list",
			remoteAddress: "127.0.0.1",
			headers: { cookie },
		})
		expect(res.statusCode).toBe(200)
	})

	test("version.switchTo mutation is allowed even in read-only mode", async () => {
		const cookie = await loginCookie()
		const res = await built.app.inject({
			method: "POST",
			url: "/trpc/version.switchTo",
			remoteAddress: "127.0.0.1",
			headers: { cookie, "content-type": "application/json" },
			payload: JSON.stringify({ json: { version: 2 } }),
		})
		// Should NOT be 403; it may be 200 (success) or another non-FORBIDDEN code
		expect(res.statusCode).not.toBe(403)
	})

	test("HTTP character image upload is blocked in read-only mode", async () => {
		const cookie = await loginCookie()
		const res = await built.app.inject({
			method: "PUT",
			url: "/api/characters/char-1/images/avatar",
			remoteAddress: "127.0.0.1",
			headers: {
				cookie,
				"content-type": "application/octet-stream",
				"x-filename": "avatar.jpg",
			},
			payload: Buffer.from("not-an-image"),
		})
		expect(res.statusCode).toBe(403)
		expect(res.json().error).toMatch(/read-only archive/)
	})

	test("HTTP character image delete is blocked in read-only mode", async () => {
		const cookie = await loginCookie()
		const res = await built.app.inject({
			method: "DELETE",
			url: "/api/characters/char-1/images/avatar",
			remoteAddress: "127.0.0.1",
			headers: { cookie },
		})
		expect(res.statusCode).toBe(403)
		expect(res.json().error).toMatch(/read-only archive/)
	})

	test("HTTP ordered upload is blocked in read-only mode", async () => {
		const cookie = await loginCookie()
		const res = await built.app.inject({
			method: "POST",
			url: "/api/uploads/ordered",
			remoteAddress: "127.0.0.1",
			headers: { cookie, "content-type": "application/json" },
			payload: JSON.stringify({}),
		})
		expect(res.statusCode).toBe(403)
		expect(res.json().error).toMatch(/read-only archive/)
	})

	test("bulk-source.zip download is still reachable in read-only mode", async () => {
		const cookie = await loginCookie()
		const res = await built.app.inject({
			method: "POST",
			url: "/api/resources/bulk-source.zip",
			remoteAddress: "127.0.0.1",
			headers: { cookie, "content-type": "application/json" },
			payload: JSON.stringify({
				ids: ["res-1"],
				dateStamp: "2024-01-01",
			}),
		})
		// The unknown resource causes a 404, but the request must NOT be
		// blocked at the read-only middleware (which would return 403).
		expect(res.statusCode).not.toBe(403)
		expect(res.statusCode).toBe(404)
	})

	test("read-only safe GET routes are not blocked", async () => {
		const cookie = await loginCookie()
		const routes = [
			{ method: "GET", url: "/api/characters/char-1/images/avatar" },
			{ method: "GET", url: "/api/characters/char-1/thumb/avatar" },
			{ method: "GET", url: "/api/resources/res-1/source.zip" },
			{ method: "GET", url: "/api/resources/res-1/files/foo.png" },
			{ method: "GET", url: "/api/uploads/staged/file-1/preview" },
			{ method: "GET", url: "/api/cache/trash" },
			{ method: "GET", url: "/api/resources/res-1/cover" },
		]
		for (const route of routes) {
			const res = await built.app.inject({
				method: route.method as "GET",
				url: route.url,
				remoteAddress: "127.0.0.1",
				headers: { cookie },
			})
			expect(res.statusCode, `${route.method} ${route.url}`).not.toBe(403)
		}
	})

	test("read-only safe POST routes are not blocked", async () => {
		const cookie = await loginCookie()
		const routes = [
			{
				method: "POST",
				url: "/api/upload-previews",
				headers: { cookie, "content-type": "multipart/form-data" },
			},
		]
		for (const route of routes) {
			const res = await built.app.inject({
				method: route.method as "POST",
				url: route.url,
				remoteAddress: "127.0.0.1",
				headers: route.headers,
			})
			expect(res.statusCode, `${route.method} ${route.url}`).not.toBe(403)
		}
	})

	test("unmarked write routes are blocked in read-only mode", async () => {
		const cookie = await loginCookie()
		const routes = [
			{ method: "PUT", url: "/api/resources/res-1/cover" },
			{ method: "DELETE", url: "/api/resources/res-1/cover" },
			{ method: "POST", url: "/api/uploads/archive" },
			{ method: "POST", url: "/api/precache" },
			{ method: "POST", url: "/api/precache/abort" },
			{ method: "POST", url: "/api/plugin-upload" },
			{ method: "DELETE", url: "/api/cache" },
		]
		for (const route of routes) {
			const res = await built.app.inject({
				method: route.method as "POST" | "PUT" | "DELETE",
				url: route.url,
				remoteAddress: "127.0.0.1",
				headers: { cookie },
			})
			expect(res.statusCode, `${route.method} ${route.url}`).toBe(403)
			expect(res.json().error, `${route.method} ${route.url}`).toMatch(
				/read-only archive/,
			)
		}
	})
})

describe("FORCE_HTTPS", () => {
	let built: BuiltServer
	let dbh: ReturnType<typeof openDb>
	let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined
	let consoleInfoSpy: ReturnType<typeof vi.spyOn> | undefined

	beforeEach(async () => {
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
		dbh = openDb(":memory:")
		dbh.runMigrations()
		const passwordHash = await hashPassword("hunter2")
		dbh.db
			.insert(schema.auth)
			.values({ singleton: 1, passwordHash, updatedAt: Date.now() })
			.run()
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			FORCE_HTTPS: "true",
		} satisfies NodeJS.ProcessEnv)
		built = await buildServer({ env, dbHandles: dbh })
		await built.app.ready()
	})

	afterEach(async () => {
		await built.close()
		dbh.close()
		consoleWarnSpy?.mockRestore()
		consoleInfoSpy?.mockRestore()
	})

	test("plain HTTP login is rejected with 426", async () => {
		const res = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			remoteAddress: "127.0.0.1",
			payload: { password: "hunter2" },
		})
		expect(res.statusCode).toBe(426)
		expect(res.json()).toEqual({ error: "HTTPS required" })
	})

	test("plain HTTP status check is rejected with 426", async () => {
		const res = await built.app.inject({
			method: "GET",
			url: "/auth/status",
			remoteAddress: "127.0.0.1",
		})
		expect(res.statusCode).toBe(426)
	})

	test("plain HTTP setup and password change are rejected with 426", async () => {
		for (const [method, url, payload] of [
			["POST", "/auth/setup", { password: "hunter2" }],
			[
				"POST",
				"/auth/password",
				{ currentPassword: "hunter2", newPassword: "new-password" },
			],
		] as const) {
			const res = await built.app.inject({
				method,
				url,
				remoteAddress: "127.0.0.1",
				payload,
			})
			expect(res.statusCode).toBe(426)
		}
	})

	test("login behind TLS-terminating proxy succeeds and sets Secure cookie", async () => {
		const res = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			remoteAddress: "127.0.0.1",
			headers: { "x-forwarded-proto": "https" },
			payload: { password: "hunter2" },
		})
		expect(res.statusCode).toBe(200)
		const cookieLine = firstSetCookie(res.headers["set-cookie"])
		expect(cookieLine).toMatch(/Secure/i)
	})
})

describe("trash listing", () => {
	let root: string
	let built: BuiltServer
	let dbh: ReturnType<typeof openDb>
	let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined
	let consoleInfoSpy: ReturnType<typeof vi.spyOn> | undefined

	beforeEach(async () => {
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
		root = mkdtempSync(join(tmpdir(), "app-trash-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		const passwordHash = await hashPassword("hunter2")
		dbh.db
			.insert(schema.auth)
			.values({ singleton: 1, passwordHash, updatedAt: Date.now() })
			.run()
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
		} satisfies NodeJS.ProcessEnv)
		built = await buildServer({ env, dbHandles: dbh })
		await built.app.ready()
	})

	afterEach(async () => {
		await built.close()
		dbh.close()
		rmSync(root, { recursive: true, force: true })
		consoleWarnSpy?.mockRestore()
		consoleInfoSpy?.mockRestore()
	})

	test("GET /api/cache/trash only lists resource entries", async () => {
		const trashDir = join(root, "local", "trash")
		for (const name of [
			"resources-res-1-1700000000000",
			"characters-char-1-1700000000001",
			"db-1700000000002",
		]) {
			mkdirSync(join(trashDir, name), { recursive: true })
			writeFileSync(join(trashDir, name, "placeholder.txt"), "x")
		}

		const login = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			remoteAddress: "127.0.0.1",
			payload: { password: "hunter2" },
		})
		expect(login.statusCode).toBe(200)
		const cookieLine = firstSetCookie(login.headers["set-cookie"])
		const cookie = cookieLine.split(";")[0]
		assertString(cookie)

		const res = await built.app.inject({
			method: "GET",
			url: "/api/cache/trash",
			remoteAddress: "127.0.0.1",
			headers: { cookie },
		})
		expect(res.statusCode).toBe(200)
		const body = res.json()
		expect(body.items).toHaveLength(1)
		expect(body.items[0].name).toBe("resources-res-1-1700000000000")
		expect(body.items[0].kind).toBe("resource")
	})
})

describe("health endpoint", () => {
	let built: BuiltServer
	let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined
	let consoleInfoSpy: ReturnType<typeof vi.spyOn> | undefined

	beforeEach(async () => {
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
		built = await bootstrap()
		await built.app.ready()
	})

	afterEach(async () => {
		await built.close()
		built.db.close()
		consoleWarnSpy?.mockRestore()
		consoleInfoSpy?.mockRestore()
	})

	test("GET /api/health reports volume and auto-snapshot state without auth", async () => {
		const res = await built.app.inject({
			method: "GET",
			url: "/api/health",
		})
		expect(res.statusCode).toBe(200)
		const body = res.json()
		expect(body.status).toBe("ok")
		expect(body.autoSnapshot).toMatchObject({ enabled: true, keep: 3 })
		expect(
			body.autoSnapshot.lastAt === null ||
				typeof body.autoSnapshot.lastAt === "number",
		).toBe(true)
		if (body.storage !== null) {
			expect(typeof body.storage.totalBytes).toBe("number")
			expect(typeof body.storage.freeBytes).toBe("number")
		}
	})
})

describe("plugin upload limits", () => {
	let built: BuiltServer
	let dbh: ReturnType<typeof openDb>
	let consoleWarnSpy: ReturnType<typeof vi.spyOn> | undefined
	let consoleInfoSpy: ReturnType<typeof vi.spyOn> | undefined

	beforeEach(async () => {
		consoleWarnSpy = vi.spyOn(console, "warn").mockImplementation(() => {})
		consoleInfoSpy = vi.spyOn(console, "info").mockImplementation(() => {})
		dbh = openDb(":memory:")
		dbh.runMigrations()
		const passwordHash = await hashPassword("hunter2")
		dbh.db
			.insert(schema.auth)
			.values({ singleton: 1, passwordHash, updatedAt: Date.now() })
			.run()
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			PLUGIN_UPLOAD_MAX_BYTES: "1024",
		} satisfies NodeJS.ProcessEnv)
		built = await buildServer({ env, dbHandles: dbh })
		await built.app.ready()
	})

	afterEach(async () => {
		await built.close()
		dbh.close()
		consoleWarnSpy?.mockRestore()
		consoleInfoSpy?.mockRestore()
	})

	async function loginCookie(): Promise<string> {
		const login = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			remoteAddress: "127.0.0.1",
			payload: { password: "hunter2" },
		})
		expect(login.statusCode).toBe(200)
		const cookieLine = firstSetCookie(login.headers["set-cookie"])
		const headerPart = cookieLine.split(";")[0]
		assertString(headerPart)
		return headerPart
	}

	async function buildZip(
		entries: readonly (readonly [string, Buffer])[],
	): Promise<Buffer> {
		const zip = new yazl.ZipFile()
		for (const [name, data] of entries) {
			zip.addBuffer(data, name)
		}
		zip.end()
		return buffer(zip.outputStream)
	}

	function multipartZip(zipBuf: Buffer): {
		readonly payload: Buffer
		readonly contentType: string
	} {
		const boundary = "----hoardodile-test-boundary"
		return {
			payload: Buffer.concat([
				Buffer.from(
					`--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="plugin.zip"\r\nContent-Type: application/zip\r\n\r\n`,
				),
				zipBuf,
				Buffer.from(`\r\n--${boundary}--\r\n`),
			]),
			contentType: `multipart/form-data; boundary=${boundary}`,
		}
	}

	test("rejects a plugin zip over the compressed limit with 413", async () => {
		const cookie = await loginCookie()
		// Random bytes are incompressible, so the zip clears 1024 bytes.
		const zipBuf = await buildZip([
			["manifest.json", Buffer.from("{}")],
			["blob.bin", randomBytes(2048)],
		])
		const { payload, contentType } = multipartZip(zipBuf)
		const res = await built.app.inject({
			method: "POST",
			url: "/api/plugin-upload",
			remoteAddress: "127.0.0.1",
			headers: { cookie, "content-type": contentType },
			payload,
		})
		expect(res.statusCode).toBe(413)
		expect(res.json().kind).toBe("plugin.upload_too_large")
	})

	test("rejects a plugin zip over the extracted budget with 400", async () => {
		const cookie = await loginCookie()
		// 2048 zero bytes deflate to almost nothing: the compressed upload
		// passes the 1024-byte cap, but extraction exceeds the budget.
		const zipBuf = await buildZip([
			["manifest.json", Buffer.from("{}")],
			["zeros.bin", Buffer.alloc(2048, 0)],
		])
		const { payload, contentType } = multipartZip(zipBuf)
		const res = await built.app.inject({
			method: "POST",
			url: "/api/plugin-upload",
			remoteAddress: "127.0.0.1",
			headers: { cookie, "content-type": contentType },
			payload,
		})
		expect(res.statusCode).toBe(400)
		expect(res.json().kind).toBe("resource.archive_too_large")
	})

	test("rejects a non-zip plugin archive with a format error", async () => {
		const cookie = await loginCookie()
		// A real gzip stream: the archive engine accepts gzip in general,
		// but the plugin channel is zip-only (the CLI publishes zips, the
		// marketplace picks zip assets) — anything else must be refused.
		const { gzipSync } = await import("node:zlib")
		const gz = gzipSync(Buffer.from("not a plugin package"))
		const boundary = "----hoardodile-test-boundary"
		const payload = Buffer.concat([
			Buffer.from(
				`--${boundary}\r\nContent-Disposition: form-data; name="archive"; filename="plugin.zip"\r\nContent-Type: application/zip\r\n\r\n`,
			),
			gz,
			Buffer.from(`\r\n--${boundary}--\r\n`),
		])
		const res = await built.app.inject({
			method: "POST",
			url: "/api/plugin-upload",
			remoteAddress: "127.0.0.1",
			headers: {
				cookie,
				"content-type": `multipart/form-data; boundary=${boundary}`,
			},
			payload,
		})
		expect(res.statusCode).toBe(400)
		expect(res.json().kind).toBe("resource.archive_format_not_allowed")
	})

	test("marketplace install rejects non-GitHub hosts and unauthenticated calls", async () => {
		const cookie = await loginCookie()
		const payload = {
			id: "22222222-2222-4222-8222-222222222222",
			repo: "me/plugin",
			assetUrl: "https://evil.example.com/plugin.zip",
		}
		// The host allowlist is the first gate: no download is attempted.
		const res = await built.app.inject({
			method: "POST",
			url: "/api/plugin-marketplace/install",
			remoteAddress: "127.0.0.1",
			headers: { cookie },
			payload,
		})
		expect(res.statusCode).toBe(400)
		expect(res.json().kind).toBe("marketplace.asset_host_forbidden")

		const unauth = await built.app.inject({
			method: "POST",
			url: "/api/plugin-marketplace/install",
			remoteAddress: "127.0.0.1",
			payload,
		})
		expect(unauth.statusCode).toBe(401)
	})

	test("re-uploading (updating) a plugin keeps its asset vault", async () => {
		const cookie = await loginCookie()
		const baseManifest = {
			id: "22222222-2222-4222-8222-222222222222",
			name: "update-test",
			description: "update test plugin",
			version: "1.0.0",
			permissions: { download: true },
		}
		function pluginZip(version: string) {
			return buildZip([
				[
					"manifest.json",
					Buffer.from(JSON.stringify({ ...baseManifest, version })),
				],
				["main.js", Buffer.from("export default {}\n")],
			])
		}
		const firstPayload = multipartZip(await pluginZip("1.0.0"))
		const first = await built.app.inject({
			method: "POST",
			url: "/api/plugin-upload",
			remoteAddress: "127.0.0.1",
			headers: { cookie, "content-type": firstPayload.contentType },
			payload: firstPayload.payload,
		})
		expect(first.statusCode).toBe(200)

		// The host wrote a downloaded asset into the plugin's vault.
		const vaultDir = join(
			built.app.paths.latest.plugins(),
			baseManifest.id,
			"vault",
		)
		mkdirSync(vaultDir, { recursive: true })
		writeFileSync(join(vaultDir, "runtime.mjs"), "vault-data")

		// Update: same id, new version, vault must survive the swap.
		const secondPayload = multipartZip(await pluginZip("2.0.0"))
		const second = await built.app.inject({
			method: "POST",
			url: "/api/plugin-upload",
			remoteAddress: "127.0.0.1",
			headers: { cookie, "content-type": secondPayload.contentType },
			payload: secondPayload.payload,
		})
		expect(second.statusCode).toBe(200)
		expect(readFileSync(join(vaultDir, "runtime.mjs"), "utf-8")).toBe(
			"vault-data",
		)
	})
})

describe("POST /api/internal/shutdown", () => {
	const token = "desktop-shutdown-secret"

	async function bootstrapWithShutdown(
		onAuthorizedShutdown: () => void | Promise<void>,
	): Promise<BuiltServer> {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			HOARDODILE_SHUTDOWN_TOKEN: token,
		} satisfies NodeJS.ProcessEnv)
		const db = openDb(":memory:")
		db.runMigrations()
		return buildServer({ env, dbHandles: db, onAuthorizedShutdown })
	}

	test("wrong token is 401 and does not invoke the shutdown callback", async () => {
		let called = 0
		const built = await bootstrapWithShutdown(() => {
			called += 1
		})
		await built.app.ready()
		try {
			const res = await built.app.inject({
				method: "POST",
				url: "/api/internal/shutdown",
				remoteAddress: "127.0.0.1",
				headers: { "x-shutdown-token": "nope" },
			})
			expect(res.statusCode).toBe(401)
			expect(called).toBe(0)
			const health = await built.app.inject({
				method: "GET",
				url: "/health",
				remoteAddress: "127.0.0.1",
			})
			expect(health.statusCode).toBe(200)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("matching header token is 200 and invokes the shutdown callback", async () => {
		let called = 0
		const built = await bootstrapWithShutdown(() => {
			called += 1
		})
		await built.app.ready()
		try {
			const res = await built.app.inject({
				method: "POST",
				url: "/api/internal/shutdown",
				remoteAddress: "127.0.0.1",
				headers: { "x-shutdown-token": token },
			})
			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ ok: true })
			await vi.waitFor(() => {
				expect(called).toBe(1)
			})
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("matching body token is 200 and invokes the shutdown callback", async () => {
		let called = 0
		const built = await bootstrapWithShutdown(() => {
			called += 1
		})
		await built.app.ready()
		try {
			const res = await built.app.inject({
				method: "POST",
				url: "/api/internal/shutdown",
				remoteAddress: "127.0.0.1",
				headers: { "content-type": "application/json" },
				payload: { token },
			})
			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ ok: true })
			await vi.waitFor(() => {
				expect(called).toBe(1)
			})
		} finally {
			await built.close()
			built.db.close()
		}
	})
})

describe("POST /api/internal/shared-folder", () => {
	const token = "desktop-shutdown-secret"
	const initialRoot = "C:/old-share"
	const nextRoot = "C:/new-share"

	async function bootstrapSharedFolder(): Promise<BuiltServer> {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			HOARDODILE_SHUTDOWN_TOKEN: token,
			SHARED_FOLDER_ROOT: initialRoot,
		} satisfies NodeJS.ProcessEnv)
		const db = openDb(":memory:")
		db.runMigrations()
		const passwordHash = await hashPassword("hunter2")
		db.db
			.insert(schema.auth)
			.values({ singleton: 1, passwordHash, updatedAt: Date.now() })
			.run()
		return buildServer({ env, dbHandles: db })
	}

	async function loginCookie(built: BuiltServer): Promise<string> {
		const login = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			remoteAddress: "127.0.0.1",
			payload: { password: "hunter2" },
		})
		expect(login.statusCode).toBe(200)
		const cookieLine = firstSetCookie(login.headers["set-cookie"])
		const headerPart = cookieLine.split(";")[0]
		assertString(headerPart)
		return headerPart
	}

	async function readImportRoot(
		built: BuiltServer,
		cookie: string,
	): Promise<string | undefined> {
		const res = await built.app.inject({
			method: "GET",
			url: "/trpc/resource.importConfig",
			remoteAddress: "127.0.0.1",
			headers: { cookie },
		})
		expect(res.statusCode).toBe(200)
		const body = res.json()
		assertTrpcEnvelope<{ sharedFolderRoot: string | undefined }>(body)
		return body.result.data.sharedFolderRoot
	}

	test("wrong token is 401 and leaves the import root unchanged", async () => {
		const built = await bootstrapSharedFolder()
		await built.app.ready()
		try {
			const cookie = await loginCookie(built)
			const res = await built.app.inject({
				method: "POST",
				url: "/api/internal/shared-folder",
				remoteAddress: "127.0.0.1",
				headers: {
					"content-type": "application/json",
					"x-shutdown-token": "nope",
				},
				payload: { path: nextRoot },
			})
			expect(res.statusCode).toBe(401)
			expect(await readImportRoot(built, cookie)).toBe(initialRoot)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("matching token live-patches importConfig to the new absolute path", async () => {
		const built = await bootstrapSharedFolder()
		await built.app.ready()
		try {
			const cookie = await loginCookie(built)
			expect(await readImportRoot(built, cookie)).toBe(initialRoot)
			const res = await built.app.inject({
				method: "POST",
				url: "/api/internal/shared-folder",
				remoteAddress: "127.0.0.1",
				headers: {
					"content-type": "application/json",
					"x-shutdown-token": token,
				},
				payload: { path: nextRoot },
			})
			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ ok: true })
			expect(await readImportRoot(built, cookie)).toBe(nextRoot)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("null path live-clears importConfig", async () => {
		const built = await bootstrapSharedFolder()
		await built.app.ready()
		try {
			const cookie = await loginCookie(built)
			expect(await readImportRoot(built, cookie)).toBe(initialRoot)
			const res = await built.app.inject({
				method: "POST",
				url: "/api/internal/shared-folder",
				remoteAddress: "127.0.0.1",
				headers: {
					"content-type": "application/json",
					"x-shutdown-token": token,
				},
				payload: { path: null },
			})
			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ ok: true })
			expect(await readImportRoot(built, cookie)).toBeUndefined()
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("relative path is 400 and leaves the import root unchanged", async () => {
		const built = await bootstrapSharedFolder()
		await built.app.ready()
		try {
			const cookie = await loginCookie(built)
			const res = await built.app.inject({
				method: "POST",
				url: "/api/internal/shared-folder",
				remoteAddress: "127.0.0.1",
				headers: {
					"content-type": "application/json",
					"x-shutdown-token": token,
				},
				payload: { path: "tmp/import" },
			})
			expect(res.statusCode).toBe(400)
			expect(await readImportRoot(built, cookie)).toBe(initialRoot)
		} finally {
			await built.close()
			built.db.close()
		}
	})
})

describe("GET /api/internal/auth-configured", () => {
	const token = "desktop-shutdown-secret"
	const strongPassword = "correct-horse-battery"

	async function bootstrapAuthConfigured(
		withPassword: boolean,
		password = strongPassword,
	): Promise<BuiltServer> {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			HOARDODILE_SHUTDOWN_TOKEN: token,
		} satisfies NodeJS.ProcessEnv)
		const db = openDb(":memory:")
		db.runMigrations()
		if (withPassword) {
			const passwordHash = await hashPassword(password)
			db.db
				.insert(schema.auth)
				.values({
					singleton: 1,
					passwordHash,
					updatedAt: Date.now(),
					weakPassword: password.length < 8 || /^\d+$/.test(password) ? 1 : 0,
				})
				.run()
		}
		return buildServer({ env, dbHandles: db })
	}

	test("valid token: configured true when a password exists", async () => {
		const built = await bootstrapAuthConfigured(true)
		await built.app.ready()
		try {
			const res = await built.app.inject({
				method: "GET",
				url: "/api/internal/auth-configured",
				remoteAddress: "127.0.0.1",
				headers: { "x-shutdown-token": token },
			})
			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ configured: true, weakPassword: false })
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("valid token: weakPassword true for a short admin password", async () => {
		const built = await bootstrapAuthConfigured(true, "1234")
		await built.app.ready()
		try {
			const res = await built.app.inject({
				method: "GET",
				url: "/api/internal/auth-configured",
				remoteAddress: "127.0.0.1",
				headers: { "x-shutdown-token": token },
			})
			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ configured: true, weakPassword: true })
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("valid token: configured false when no password exists", async () => {
		const built = await bootstrapAuthConfigured(false)
		await built.app.ready()
		try {
			const res = await built.app.inject({
				method: "GET",
				url: "/api/internal/auth-configured",
				remoteAddress: "127.0.0.1",
				headers: { "x-shutdown-token": token },
			})
			expect(res.statusCode).toBe(200)
			expect(res.json()).toEqual({ configured: false, weakPassword: false })
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("missing token is 401", async () => {
		const built = await bootstrapAuthConfigured(true)
		await built.app.ready()
		try {
			const res = await built.app.inject({
				method: "GET",
				url: "/api/internal/auth-configured",
				remoteAddress: "127.0.0.1",
			})
			expect(res.statusCode).toBe(401)
		} finally {
			await built.close()
			built.db.close()
		}
	})
})

describe("desktop control routes reject non-loopback peers", () => {
	const token = "desktop-shutdown-secret"

	async function bootstrapControlRoutes(): Promise<BuiltServer> {
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			HOARDODILE_SHUTDOWN_TOKEN: token,
		} satisfies NodeJS.ProcessEnv)
		const db = openDb(":memory:")
		db.runMigrations()
		return buildServer({ env, dbHandles: db })
	}

	test("POST /api/internal/shutdown is 403 from a LAN peer even with the valid token", async () => {
		const built = await bootstrapControlRoutes()
		await built.app.ready()
		try {
			const res = await built.app.inject({
				method: "POST",
				url: "/api/internal/shutdown",
				remoteAddress: "192.168.1.50",
				headers: { "x-shutdown-token": token },
			})
			expect(res.statusCode).toBe(403)
			const health = await built.app.inject({
				method: "GET",
				url: "/health",
				remoteAddress: "127.0.0.1",
			})
			expect(health.statusCode).toBe(200)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("GET /api/internal/auth-configured is 403 from a LAN peer even with the valid token", async () => {
		const built = await bootstrapControlRoutes()
		await built.app.ready()
		try {
			const res = await built.app.inject({
				method: "GET",
				url: "/api/internal/auth-configured",
				remoteAddress: "192.168.1.50",
				headers: { "x-shutdown-token": token },
			})
			expect(res.statusCode).toBe(403)
		} finally {
			await built.close()
			built.db.close()
		}
	})
})

describe("POST /auth/login records sign-ins and refreshes password weakness", () => {
	const strongPassword = "correct-horse-battery"
	const chromeUA =
		"Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36"

	async function bootstrapLogin(): Promise<BuiltServer> {
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
		return buildServer({ env, dbHandles: db })
	}

	async function login(
		built: BuiltServer,
		opts: { remoteAddress: string; userAgent?: string },
	): Promise<string> {
		const res = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			remoteAddress: opts.remoteAddress,
			headers:
				opts.userAgent !== undefined ? { "user-agent": opts.userAgent } : {},
			payload: { password: "hunter2" },
		})
		expect(res.statusCode).toBe(200)
		const cookieLine = firstSetCookie(res.headers["set-cookie"])
		const headerPart = cookieLine.split(";")[0]
		assertString(headerPart)
		return headerPart
	}

	test("records a LAN sign-in with the parsed device label", async () => {
		const built = await bootstrapLogin()
		await built.app.ready()
		try {
			await login(built, { remoteAddress: "192.168.1.50", userAgent: chromeUA })
			const rows = built.db.db.select().from(schema.authSignIns).all()
			expect(rows).toHaveLength(1)
			expect(rows[0]?.ip).toBe("192.168.1.50")
			expect(rows[0]?.origin).toBe("lan")
			expect(rows[0]?.deviceLabel).toBe("Chrome on Windows")
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("records a loopback sign-in and re-evaluates weakness", async () => {
		const built = await bootstrapLogin()
		await built.app.ready()
		try {
			await login(built, { remoteAddress: "127.0.0.1" })
			const rows = built.db.db.select().from(schema.authSignIns).all()
			expect(rows[0]?.origin).toBe("loopback")
			expect(rows[0]?.deviceLabel).toBe("Unknown device")
			const authRow = built.db.db.select().from(schema.auth).get()
			expect(authRow?.weakPassword).toBe(1) // "hunter2" is weak (7 chars)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("changing to a strong password clears the weakness flag", async () => {
		const built = await bootstrapLogin()
		await built.app.ready()
		try {
			const cookie = await login(built, { remoteAddress: "127.0.0.1" })
			const res = await built.app.inject({
				method: "POST",
				url: "/auth/password",
				remoteAddress: "127.0.0.1",
				headers: { cookie },
				payload: { currentPassword: "hunter2", newPassword: strongPassword },
			})
			expect(res.statusCode).toBe(200)
			const authRow = built.db.db.select().from(schema.auth).get()
			expect(authRow?.weakPassword).toBe(0)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("GET /trpc/access.connections returns the newest sign-ins", async () => {
		const built = await bootstrapLogin()
		await built.app.ready()
		try {
			const cookie = await login(built, {
				remoteAddress: "192.168.1.50",
				userAgent: chromeUA,
			})
			const res = await built.app.inject({
				method: "GET",
				url: "/trpc/access.connections",
				remoteAddress: "127.0.0.1",
				headers: { cookie },
			})
			expect(res.statusCode).toBe(200)
			const body = res.json()
			assertTrpcEnvelope<{
				connections: readonly {
					ip: string
					origin: string
					deviceLabel: string
					recordedAt: number
				}[]
			}>(body)
			expect(body.result.data.connections).toHaveLength(1)
			expect(body.result.data.connections[0]?.ip).toBe("192.168.1.50")
			expect(body.result.data.connections[0]?.origin).toBe("lan")
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("GET /trpc/access.connections is 401 without a session", async () => {
		const built = await bootstrapLogin()
		await built.app.ready()
		try {
			const res = await built.app.inject({
				method: "GET",
				url: "/trpc/access.connections",
				remoteAddress: "127.0.0.1",
			})
			expect(res.statusCode).toBe(401)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("GET /trpc/network.info reports the resolved outbound proxy state", async () => {
		const built = await bootstrapLogin()
		await built.app.ready()
		try {
			const cookie = await login(built, {
				remoteAddress: "127.0.0.1",
				userAgent: chromeUA,
			})
			const res = await built.app.inject({
				method: "GET",
				url: "/trpc/network.info",
				remoteAddress: "127.0.0.1",
				headers: { cookie },
			})
			expect(res.statusCode).toBe(200)
			const body = res.json()
			assertTrpcEnvelope<{
				source: string
				httpHost: string | null
				httpsHost: string | null
				bypassCount: number
			}>(body)
			expect(["explicit", "env", "system", "none"]).toContain(
				body.result.data.source,
			)
		} finally {
			await built.close()
			built.db.close()
		}
	})

	test("network.info and network.test are 401 without a session", async () => {
		const built = await bootstrapLogin()
		await built.app.ready()
		try {
			for (const path of ["/trpc/network.info", "/trpc/network.test"]) {
				const res = await built.app.inject({
					method: "GET",
					url: path,
					remoteAddress: "127.0.0.1",
				})
				expect(res.statusCode).toBe(401)
			}
		} finally {
			await built.close()
			built.db.close()
		}
	})
})
