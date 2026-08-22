import type { UserAction } from "src/domain/trace/actions.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createDocumentService, type DocService } from "./service.ts"

/**
 * Document-service ↔ trace wiring: document nodes (not folders) emit one
 * event per create/commit/softDelete/restore/hardDelete.
 */
describe("document service trace wiring", () => {
	let dbh: DbHandles
	let svc: DocService
	let actions: UserAction[]

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		actions = []
		svc = createDocumentService({
			db: dbh.db,
			onUserAction: (action) => {
				actions.push(action)
			},
		})
	})

	afterEach(() => {
		dbh.close()
	})

	test("creating a document records document.create", async () => {
		const doc = await svc.createNode({ kind: "document", title: "Notes" })
		expect(actions).toHaveLength(1)
		expect(actions[0]).toMatchObject({
			action: "document.create",
			entityType: "document",
			entityId: doc.id,
			entityName: "Notes",
		})
	})

	test("folder creation is not a footprint", async () => {
		await svc.createNode({ kind: "folder", title: "Archive" })
		expect(actions).toHaveLength(0)
	})

	test("commitDraft records document.commit with the version number", async () => {
		const doc = await svc.createNode({ kind: "document", title: "Draft" })
		actions.length = 0
		await svc.patchDraft({ id: doc.id, content: { type: "doc", content: [] } })
		const version = await svc.commitDraft({ id: doc.id, message: "v1" })
		expect(version.versionNo).toBe(1)
		expect(actions).toHaveLength(1)
		expect(actions[0]).toMatchObject({
			action: "document.commit",
			entityId: doc.id,
			entityName: "Draft",
			detail: { versionNo: 1 },
		})
	})

	test("softDelete, restore and hardDelete each record an event", async () => {
		const doc = await svc.createNode({ kind: "document", title: "Rover" })
		actions.length = 0

		await svc.softDelete(doc.id)
		expect(actions[0]).toMatchObject({
			action: "document.softDelete",
			entityId: doc.id,
			entityName: "Rover",
		})

		await svc.restore(doc.id)
		expect(actions[1]).toMatchObject({
			action: "document.restore",
			entityId: doc.id,
			entityName: "Rover",
		})

		await svc.softDelete(doc.id)
		actions.length = 0
		await svc.hardDelete(doc.id)
		expect(actions).toHaveLength(1)
		expect(actions[0]).toMatchObject({
			action: "document.hardDelete",
			entityId: doc.id,
			entityName: "Rover",
		})
	})
})
