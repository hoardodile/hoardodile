import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import type { MutableRef } from "src/infra/runtime-context.ts"
import {
	createStoragePaths,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { importLocal } from "./import.ts"
import { createResourceService, type ResService } from "./service.ts"
import { createTestHooks, createTestRegistry } from "./test-registry.ts"
import { buildResourceUploads } from "./upload.ts"

/**
 * Folder-import integration: `importLocal` is non-recursive per direct
 * item, but a *directory* item is packed recursively — so a whole comic
 * book folder (chapter subdirectories included) lands as ONE resource
 * whose file list keeps the nested chapter paths, which the manga
 * plugin's `listFiles` then groups into chapters.
 */
describe("folder import of a chapter-structured book", () => {
	let root: string
	let dbh: DbHandles
	let paths: StoragePaths
	let svc: ResService
	let uploads: ReturnType<typeof buildResourceUploads>

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-import-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		paths = createStoragePaths({ root })
		const readOnly: MutableRef<boolean> = { current: false }
		uploads = buildResourceUploads(
			paths,
			{ maxArchiveExtractedBytes: 1024 * 1024 },
			readOnly,
		)
		svc = createResourceService({
			db: dbh.db,
			paths,
			pluginHooks: createTestHooks(createTestRegistry()),
			readOnly,
			uploads,
		})
	})

	afterEach(async () => {
		await svc.drainMetaQueue()
		dbh.close()
		rmSync(root, { recursive: true, force: true })
	})

	test("a directory with chapter subdirectories imports as one resource with nested paths", async () => {
		// The import source's direct item is the whole book folder; its
		// immediate children are chapter directories.
		const sourceDir = join(root, "import-src")
		const bookDir = join(sourceDir, "my-comic")
		mkdirSync(join(bookDir, "第1话"), { recursive: true })
		mkdirSync(join(bookDir, "第2话"), { recursive: true })
		writeFileSync(join(bookDir, "第1话", "001.png"), Buffer.from("p1"))
		writeFileSync(join(bookDir, "第1话", "002.png"), Buffer.from("p2"))
		writeFileSync(join(bookDir, "第2话", "001.png"), Buffer.from("p3"))

		const report = await importLocal(
			{
				service: svc,
				uploads,
				pluginHooks: createTestHooks(createTestRegistry()),
			},
			{ sourceDir },
		)

		expect(report.imported, JSON.stringify(report)).toBe(1)
		expect(report.failed, JSON.stringify(report)).toBe(0)
		const id = report.resourceIds[0]
		expect(id).toBeDefined()

		// Nested chapter paths survive the archive packing verbatim.
		const files = (await svc.listFiles(id!)) as readonly {
			readonly filename: string
		}[]
		expect(files.map((f) => f.filename).sort()).toEqual([
			"第1话/001.png",
			"第1话/002.png",
			"第2话/001.png",
		])
	})
})
