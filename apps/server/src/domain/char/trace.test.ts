import { mkdtempSync, rmSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { UserAction } from "src/domain/trace/actions.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import {
	createStoragePaths,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { type CharService, createCharacterService } from "./service.ts"

/**
 * Character-service ↔ trace wiring: create/softDelete/restore/hardDelete
 * each emit one event with the character name snapshot.
 */
describe("character service trace wiring", () => {
	let root: string
	let dbh: DbHandles
	let paths: StoragePaths
	let svc: CharService
	let actions: UserAction[]

	beforeEach(() => {
		root = mkdtempSync(join(tmpdir(), "app-char-trace-"))
		dbh = openDb(":memory:")
		dbh.runMigrations()
		paths = createStoragePaths({ root })
		actions = []
		svc = createCharacterService({
			db: dbh.db,
			paths,
			readOnly: { current: false },
			onUserAction: (action) => {
				actions.push(action)
			},
		})
	})

	afterEach(async () => {
		dbh.close()
		for (let attempt = 0; ; attempt++) {
			try {
				rmSync(root, { recursive: true, force: true })
				break
			} catch (err) {
				if (attempt >= 4) throw err
				await new Promise((resolve) => setTimeout(resolve, 100))
			}
		}
	})

	test("create records character.create with the resolved name", async () => {
		const c = await svc.create({ name: "Echo" })
		expect(actions).toHaveLength(1)
		expect(actions[0]).toMatchObject({
			action: "character.create",
			entityType: "character",
			entityId: c.id,
			entityName: "Echo",
		})
	})

	test("softDelete, restore and hardDelete each record an event", async () => {
		const c = await svc.create({ name: "Rover" })
		actions.length = 0

		await svc.softDelete(c.id)
		expect(actions[0]).toMatchObject({
			action: "character.softDelete",
			entityId: c.id,
			entityName: "Rover",
		})

		await svc.restore(c.id)
		expect(actions[1]).toMatchObject({
			action: "character.restore",
			entityId: c.id,
			entityName: "Rover",
		})

		await svc.softDelete(c.id)
		actions.length = 0
		await svc.hardDelete(c.id)
		expect(actions).toHaveLength(1)
		expect(actions[0]).toMatchObject({
			action: "character.hardDelete",
			entityId: c.id,
			entityName: "Rover",
		})
	})
})
