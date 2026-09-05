import { execFile } from "node:child_process"
import { createHash } from "node:crypto"
import {
	link,
	mkdir,
	mkdtemp,
	readdir,
	readFile,
	rm,
	stat,
	writeFile,
} from "node:fs/promises"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"
import { loadEnv } from "src/config/env.ts"
import { hashPassword } from "src/domain/auth/password.ts"
import { getAuthRow, setAuthRow } from "src/domain/auth/repo.ts"
import { openDb, schema } from "src/infra/db/connection.ts"
import { type BuiltServer, buildServer } from "src/server.ts"
import { afterEach, expect, it } from "vitest"
import { acquireStorageInstance } from "./instance-lock.ts"

const run = promisify(execFile)
const script = fileURLToPath(
	new URL("../../../../../scripts/migrate-backup-layout.mjs", import.meta.url),
)
const builtin = fileURLToPath(
	new URL("../../../../../plugins/file/dist/", import.meta.url),
)
const roots: string[] = []
let built: BuiltServer | undefined

afterEach(async () => {
	await built?.close()
	built = undefined
	for (const root of roots.splice(0))
		await rm(root, { recursive: true, force: true })
})

async function fixture() {
	const root = await mkdtemp(join(tmpdir(), "backup-layout-migration-"))
	roots.push(root)
	await mkdir(join(root, "local"))
	await mkdir(join(root, "versions/1/plugins"), { recursive: true })
	await mkdir(join(root, "versions/.stfolder"))
	for (const folder of ["db-backups", "snapshots"])
		await mkdir(join(root, "versions/1", folder))
	await mkdir(join(root, "versions/1/resources/resource/data"), {
		recursive: true,
	})
	await writeFile(
		join(root, "versions/1/resources/resource/data/media.bin"),
		"unchanged-media",
	)
	await writeFile(join(root, "versions/1/db-backups/old.sqlite"), "old-backup")
	await writeFile(
		join(root, "versions/1/snapshots/auto.sqlite"),
		"old-snapshot",
	)
	await writeFile(
		join(root, "local/.session-key"),
		Buffer.alloc(32, 5).toString("base64"),
	)
	const db = openDb(join(root, "app.sqlite"))
	db.runMigrations()
	setAuthRow(db.db, {
		hash: await hashPassword("migration-password"),
		updatedAt: 1,
		weakPassword: false,
	})
	db.db
		.insert(schema.syncDevices)
		.values({ id: "device", name: "Desktop", createdAt: 1, updatedAt: 1 })
		.run()
	db.db
		.insert(schema.syncRecords)
		.values({ id: "record", deviceId: "device", recordedAt: 1, createdAt: 1 })
		.run()
	db.db
		.insert(schema.systemPreferences)
		.values([
			{ key: "theme", value: '"dark"', updatedAt: 1 },
			{ key: "sync.remindDays", value: "14", updatedAt: 1 },
		])
		.run()
	db.close()
	return root
}

function migrate(root: string, ...args: string[]) {
	return run(
		process.execPath,
		[script, root, "--builtin-dir", builtin, ...args],
		{ timeout: 20000 },
	)
}

async function digest(path: string) {
	return createHash("sha256")
		.update(await readFile(path))
		.digest("hex")
}

it("previews a legacy library without changing any source file", async () => {
	const root = await fixture()
	const path = join(root, "app.sqlite")
	const before = await digest(path)
	const result = await migrate(root)
	expect(result.stdout).toContain("Inspection only")
	expect(result.stdout).toContain('"addBuiltin": true')
	expect(await digest(path)).toBe(before)
	expect(await readdir(join(root, "local"))).toEqual([".session-key"])
})

it("separates host state, keeps media in place, preserves old backups, and starts the new server", async () => {
	const root = await fixture()
	const resource = join(root, "versions/1/resources/resource/data/media.bin")
	const originalResource = await stat(resource)
	await migrate(root, "--apply")
	const live = openDb(join(root, "app.sqlite")),
		host = openDb(join(root, "local/host.sqlite"))
	const original = openDb(
		join(root, "local/backup-layout-migration/original.sqlite"),
	)
	try {
		expect(getAuthRow(live.db)).toBeUndefined()
		expect(getAuthRow(host.db)).toEqual(getAuthRow(original.db))
		expect(live.db.select().from(schema.syncDevices).all()).toEqual([])
		expect(host.db.select().from(schema.syncRecords).get()?.deviceId).toBe(
			"device",
		)
		expect(
			host.db
				.select()
				.from(schema.systemPreferences)
				.all()
				.map((row) => row.key),
		).toEqual(["sync.remindDays"])
		expect(
			live.db
				.select()
				.from(schema.systemPreferences)
				.all()
				.map((row) => row.key),
		).toEqual(["theme"])
	} finally {
		live.close()
		host.close()
		original.close()
	}
	expect(await readFile(resource, "utf8")).toBe("unchanged-media")
	expect((await stat(resource)).ino).toBe(originalResource.ino)
	expect((await stat(resource)).mtimeMs).toBe(originalResource.mtimeMs)
	expect(
		await readFile(
			join(root, "local/backup-layout-migration/db-backups/old.sqlite"),
			"utf8",
		),
	).toBe("old-backup")
	expect(
		await readFile(
			join(root, "local/backup-layout-migration/snapshots/auto.sqlite"),
			"utf8",
		),
	).toBe("old-snapshot")
	expect(await readdir(join(root, "versions/1"))).not.toContain("snapshots")
	const copiedManifest = join(
		root,
		"versions/1/plugins/a1b2c3d4-e5f6-7890-abcd-ef1234567890/manifest.json",
	)
	expect(await digest(copiedManifest)).toBe(
		await digest(join(builtin, "manifest.json")),
	)
	const hostBefore = await digest(join(root, "local/host.sqlite"))
	await migrate(root, "--apply")
	expect(await digest(join(root, "local/host.sqlite"))).toBe(hostBefore)
	expect(await readFile(join(root, "local/.session-key"), "utf8")).toBe(
		Buffer.alloc(32, 5).toString("base64"),
	)
	built = await buildServer({
		env: loadEnv({
			NODE_ENV: "test",
			LOG_LEVEL: "silent",
			STORAGE_ROOT: root,
			DISABLE_DEV_PLUGINS: "true",
		}),
	})
	const response = await built.app.inject({
		method: "POST",
		url: "/auth/login",
		payload: { password: "migration-password" },
	})
	expect(response.statusCode).toBe(200)
}, 30000)

it("refuses an active service before creating migration files", async () => {
	const root = await fixture()
	const release = acquireStorageInstance(root)
	try {
		await expect(migrate(root, "--apply")).rejects.toMatchObject({
			stderr: expect.stringContaining("Stop the server"),
		})
		expect(await readdir(join(root, "local"))).not.toContain(
			"backup-layout-migration",
		)
	} finally {
		release()
	}
})

it("refuses archived layouts and older schemas before writing", async () => {
	const root = await fixture()
	await mkdir(join(root, "versions/2"))
	await expect(migrate(root, "--apply")).rejects.toMatchObject({
		stderr: expect.stringContaining("no frozen archives"),
	})
	await rm(join(root, "versions/2"), { recursive: true })
	const db = openDb(join(root, "app.sqlite"))
	await db.db.run("DELETE FROM __drizzle_migrations")
	db.close()
	await expect(migrate(root, "--apply")).rejects.toMatchObject({
		stderr: expect.stringContaining("schema is not current"),
	})
	expect(await readdir(join(root, "local"))).toEqual([".session-key"])
})

it("resumes after host rows were removed but host publication was interrupted", async () => {
	const root = await fixture()
	await migrate(root, "--apply")
	const work = join(root, "local/backup-layout-migration")
	await rm(join(root, "local/host.sqlite"))
	await writeFile(
		join(work, "state.json"),
		JSON.stringify({ format: 1, phase: "prepared" }),
	)
	await migrate(root, "--apply")
	const host = openDb(join(root, "local/host.sqlite"))
	try {
		expect(getAuthRow(host.db)?.hash).toBeTruthy()
		expect(host.db.select().from(schema.syncRecords).all()).toHaveLength(1)
	} finally {
		host.close()
	}
})

it("rejects broken plugin trees without changing the library", async () => {
	const root = await fixture()
	const db = openDb(join(root, "app.sqlite"))
	db.db
		.insert(schema.contentPlugins)
		.values({
			id: "missing-plugin",
			manifest: "{}",
			priority: 1,
			createdAt: 1,
			updatedAt: 1,
		})
		.run()
	db.close()
	const before = await digest(join(root, "app.sqlite"))
	await expect(migrate(root, "--apply")).rejects.toThrow()
	expect(await digest(join(root, "app.sqlite"))).toBe(before)
	expect(await readdir(join(root, "local"))).toEqual([".session-key"])
})

it("refuses shared plugin files before preparing a migration", async () => {
	const root = await fixture()
	const source = join(root, "shared.bin")
	await writeFile(source, "shared-plugin-content")
	await link(source, join(root, "versions/1/plugins/shared.bin"))
	await expect(migrate(root, "--apply")).rejects.toMatchObject({
		stderr: expect.stringContaining("independent file"),
	})
	expect(await readdir(join(root, "local"))).toEqual([".session-key"])
})
