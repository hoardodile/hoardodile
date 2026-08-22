import {
	existsSync,
	mkdirSync,
	mkdtempSync,
	rmSync,
	writeFileSync,
} from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resources } from "src/domain/res/schema.ts"
import { openDb } from "src/infra/db/connection.ts"
import { createStoragePaths } from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { buildResourceFiles, cleanupOrphanResourceFolders } from "./files.ts"

describe("cleanupOrphanResourceFolders", () => {
	let root: string
	let paths: ReturnType<typeof createStoragePaths>
	let dbh: ReturnType<typeof openDb>

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "res-files-"))
		paths = createStoragePaths({ root })
		dbh = openDb(paths.runtimeDb())
		dbh.runMigrations()
	})

	afterEach(() => {
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("never touches shared resource folders, only local derived folders", async () => {
		dbh.db
			.insert(resources)
			.values({
				id: "res-alive",
				name: "Alive",
				intro: "",
				fileVersion: 1,
				coverVersion: 1,
				createdAt: 1,
				updatedAt: 1,
			})
			.run()

		mkdirSync(paths.latest.resource("res-alive"), { recursive: true })
		mkdirSync(paths.latest.resource("res-orphan"), { recursive: true })
		mkdirSync(paths.local.resource("res-alive"), { recursive: true })
		mkdirSync(paths.local.resource("res-local-orphan"), { recursive: true })

		await cleanupOrphanResourceFolders(paths, dbh.db)

		expect(existsSync(paths.latest.resource("res-alive"))).toBe(true)
		expect(existsSync(paths.latest.resource("res-orphan"))).toBe(true)
		expect(existsSync(paths.local.resource("res-alive"))).toBe(true)
		expect(existsSync(paths.local.resource("res-local-orphan"))).toBe(false)
	})
})

describe("cover derivative cleanup", () => {
	let root: string
	let paths: ReturnType<typeof createStoragePaths>

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "res-deriv-"))
		paths = createStoragePaths({ root })
	})

	afterEach(() => {
		rmSync(root, { recursive: true, force: true })
	})

	function seedLocalDir(id: string): void {
		const dir = paths.local.resource(id)
		mkdirSync(join(dir, "file-preview"), { recursive: true })
		mkdirSync(join(dir, "extracted"), { recursive: true })
		writeFileSync(join(dir, "cover.webp"), "thumb")
		writeFileSync(join(dir, "file-preview", "a.avif"), "pv")
		writeFileSync(join(dir, "extracted", "clip.mp4"), "bytes")
	}

	test("clearCoverDerivatives removes only cover variants, keeps the file-list cache", async () => {
		const files = buildResourceFiles(paths, { current: false })
		await files.writeFilesCache("res-1", ["a.jpg"])
		seedLocalDir("res-1")

		await files.clearCoverDerivatives("res-1")

		const dir = paths.local.resource("res-1")
		expect(existsSync(join(dir, "cover.webp"))).toBe(false)
		expect(await files.readFilesCache("res-1")).toEqual(["a.jpg"])
		expect(existsSync(join(dir, "file-preview", "a.avif"))).toBe(true)
		expect(existsSync(join(dir, "extracted", "clip.mp4"))).toBe(true)
	})

	test("clearLocalDerivatives removes variants, file caches and the file-list cache", async () => {
		const files = buildResourceFiles(paths, { current: false })
		await files.writeFilesCache("res-1", ["a.jpg"])
		seedLocalDir("res-1")

		await files.clearLocalDerivatives("res-1")

		const dir = paths.local.resource("res-1")
		expect(existsSync(join(dir, "cover.webp"))).toBe(false)
		expect(await files.readFilesCache("res-1")).toBeUndefined()
		expect(existsSync(join(dir, "file-preview"))).toBe(false)
		expect(existsSync(join(dir, "extracted"))).toBe(false)
	})
})
