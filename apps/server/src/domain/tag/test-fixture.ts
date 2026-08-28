import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import {
	type CharService,
	createCharacterService,
} from "src/domain/char/service.ts"
import {
	createResourceService,
	type ResService,
} from "src/domain/res/service.ts"
import { createTestHooks } from "src/domain/res/test-registry.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import {
	createStoragePaths,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import { createCategoryService } from "../cat/service.ts"
import { createTagService, type TagService } from "./service.ts"

/**
 * Shared fixture for the tag-domain test suites (merge, siblings,
 * parents): one migrated in-memory database with two namespaces per kind
 * plus one resource pair and one character, mirroring the setup each file
 * used to duplicate. The dedupe suite deliberately does NOT use this —
 * it simulates a pre-rewrite schema (unique indexes dropped, raw inserts).
 */
export type TagTestContext = {
	readonly root: string
	readonly dbh: DbHandles
	readonly paths: StoragePaths
	readonly svc: TagService
	readonly resSvc: ResService
	readonly charSvc: CharService
	/** Namespace with kind `common`. */
	readonly commonId: string
	/** Namespace with kind `resource`. */
	readonly resCatId: string
	/** Namespace with kind `character`. */
	readonly charCatId: string
	readonly resId: string
	readonly resId2: string
	readonly charId: string
}

export async function createTagTestContext(): Promise<TagTestContext> {
	const root = mkdtempSync(join(tmpdir(), "app-tag-"))
	const dbh = openDb(":memory:")
	dbh.runMigrations()
	const paths = createStoragePaths({ root })
	const svc = createTagService({
		db: dbh.db,
		paths,
		readOnly: { current: false },
	})
	const catSvc = createCategoryService({ db: dbh.db })
	const commonId = (await catSvc.create({ name: "Common", kind: "common" })).id
	const resCatId = (await catSvc.create({ name: "Res", kind: "resource" })).id
	const charCatId = (await catSvc.create({ name: "Char", kind: "character" }))
		.id
	const resSvc = createResourceService({
		db: dbh.db,
		paths,
		readOnly: { current: false },
		pluginHooks: createTestHooks(),
	})
	const r1 = await resSvc.create({ name: "r1" })
	const r2 = await resSvc.create({ name: "r2" })
	const charSvc = createCharacterService({
		db: dbh.db,
		paths,
		readOnly: { current: false },
	})
	const c1 = await charSvc.create({ name: "c1" })
	return {
		root,
		dbh,
		paths,
		svc,
		resSvc,
		charSvc,
		commonId,
		resCatId,
		charCatId,
		resId: r1.id,
		resId2: r2.id,
		charId: c1.id,
	}
}

export function cleanupTagTestContext(ctx: TagTestContext): void {
	ctx.dbh.close()
	rmSync(ctx.root, { recursive: true, force: true })
}
