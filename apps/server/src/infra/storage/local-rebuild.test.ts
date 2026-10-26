import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { loadEnv } from "src/config/env.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import {
	clearAuthPassword,
	isAuthConfigured,
	writeAuthPassword,
} from "src/runtime.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, expect, it } from "vitest"

const roots: string[] = []
let built: BuiltServer | undefined
afterEach(async () => {
	await built?.close()
	built = undefined
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true })
})

it.each([
	{ version: 1, marker: "root", checkpoint: false },
	{ version: 1, marker: "none", checkpoint: true },
	{ version: 2, marker: "root", checkpoint: true },
	{ version: 2, marker: "none", checkpoint: true },
])(
	"rebuilds local for a modern library: %j",
	async ({ version, marker, checkpoint }) => {
		const root = await mkdtemp(join(tmpdir(), "local-rebuild-"))
		roots.push(root)
		const env = loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
			DISABLE_DEV_PLUGINS: "true",
		})
		built = await buildServer({ env })
		await built.app.ready()
		await writeAuthPassword(env, "before-removal")
		built.db.db
			.insert(schema.characters)
			.values({
				id: "retained",
				name: "Retained character",
				createdAt: 1,
				updatedAt: 1,
			})
			.run()
		const oldKey = await readFile(built.storagePaths.local.sessionKey())
		await built.close()
		built = undefined
		if (version === 2) {
			const db = openDb(join(root, "app.sqlite"))
			db.vacuumInto(join(root, "versions", "1", "app.sqlite"))
			db.close()
			await mkdir(join(root, "versions", "2"))
		}
		const archive = join(root, "versions", String(version))
		// The row still points at version 1 when version 2 is current.
		const characterDirectory = join(
			root,
			"versions",
			"1",
			"characters",
			"retained",
		)
		const content = join(characterDirectory, "avatar.png")
		await mkdir(characterDirectory, { recursive: true })
		await writeFile(content, "retained-image")
		if (checkpoint) {
			await mkdir(join(archive, "checkpoint"))
			await writeFile(
				join(archive, "checkpoint", "recovery.json"),
				"retained-checkpoint",
			)
		}
		const repository = join(root, "backups", "local", "config")
		await mkdir(join(root, "backups", "local"), { recursive: true })
		await writeFile(repository, "retained-backup-repository")
		await rm(join(root, "local"), { recursive: true })
		if (marker === "none")
			await rm(join(root, "storage-format.json"), { force: true })
		const frozenDatabase =
			version === 2
				? await readFile(join(root, "versions", "1", "app.sqlite"))
				: undefined

		built = await buildServer({ env })
		await built.app.ready()
		expect((await built.app.inject({ url: "/health" })).statusCode).toBe(200)
		expect((await built.app.inject({ url: "/auth/status" })).json()).toEqual({
			authenticated: false,
			configured: false,
		})
		expect((await built.app.inject({ url: "/trpc/me" })).statusCode).toBe(401)
		expect(built.storagePaths.activeVersion).toBe(version)
		expect(await readFile(built.storagePaths.local.sessionKey())).not.toEqual(
			oldKey,
		)
		const setup = await built.app.inject({
			method: "POST",
			url: "/auth/setup",
			payload: { password: "after-removal" },
		})
		expect(setup.statusCode).toBe(200)
		const login = await built.app.inject({
			method: "POST",
			url: "/auth/login",
			payload: { password: "after-removal" },
		})
		expect(login.statusCode).toBe(200)
		const image = await built.app.inject({
			url: "/api/characters/retained/images/avatar",
			headers: {
				cookie: login.cookies
					.map(({ name, value }) => `${name}=${value}`)
					.join("; "),
			},
		})
		expect(image.statusCode).toBe(200)
		expect(image.body).toBe("retained-image")
		expect(built.db.db.select().from(schema.characters).all()).toEqual([
			expect.objectContaining({ id: "retained", name: "Retained character" }),
		])
		expect(await readFile(content, "utf8")).toBe("retained-image")
		if (frozenDatabase)
			expect(await readFile(join(root, "versions", "1", "app.sqlite"))).toEqual(
				frozenDatabase,
			)
		expect(await readFile(repository, "utf8")).toBe(
			"retained-backup-repository",
		)
		if (checkpoint)
			expect(
				await readFile(join(archive, "checkpoint", "recovery.json"), "utf8"),
			).toBe("retained-checkpoint")
		await built.close()
		built = undefined
		await rm(join(root, "local"), { recursive: true })
		expect(isAuthConfigured(env)).toBe(false)
		await writeAuthPassword(env, "runtime-reset")
		expect(isAuthConfigured(env)).toBe(true)
		clearAuthPassword(env)
		expect(isAuthConfigured(env)).toBe(false)
	},
	30_000,
)
