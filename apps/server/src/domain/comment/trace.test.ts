import type { UserAction } from "src/domain/trace/actions.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { type CommentService, createCommentService } from "./service.ts"

/**
 * Comment-service ↔ trace wiring: create/softDelete/restore/hardDelete and
 * the three vote outcomes each emit exactly one event whose entity name is
 * a truncated body snapshot.
 */
describe("comment service trace wiring", () => {
	let dbh: DbHandles
	let svc: CommentService
	let actions: UserAction[]
	let nowMs: number

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		nowMs = 1_000
		actions = []
		svc = createCommentService({
			db: dbh.db,
			now: () => nowMs,
			newId: () => `cmt-${actions.length}`,
			onUserAction: (action) => {
				actions.push(action)
			},
		})
	})

	afterEach(() => {
		dbh.close()
	})

	function makeBody(len: number): string {
		return "x".repeat(len)
	}

	test("create records a comment.create with the truncated body snapshot", async () => {
		const c = await svc.create({ body: makeBody(60) })
		expect(actions).toHaveLength(1)
		expect(actions[0]).toMatchObject({
			action: "comment.create",
			entityType: "comment",
			entityId: c.id,
			entityName: `${"x".repeat(24)}…`,
		})
	})

	test("create records the floor for top-level comments", async () => {
		await svc.create({ body: "First!" })
		expect(actions[0]?.detail).toEqual({ floor: 1 })
		expect(actions[0]?.entityName).toBe("First!")
	})

	test("softDelete, restore and hardDelete each record an event", async () => {
		const c = await svc.create({ body: "Rover" })
		actions.length = 0

		await svc.softDelete(c.id)
		expect(actions[0]).toMatchObject({
			action: "comment.softDelete",
			entityId: c.id,
			entityName: "Rover",
		})

		await svc.restore(c.id)
		expect(actions[1]).toMatchObject({
			action: "comment.restore",
			entityId: c.id,
			entityName: "Rover",
		})

		await svc.softDelete(c.id)
		actions.length = 0
		await svc.hardDelete(c.id)
		expect(actions).toHaveLength(1)
		expect(actions[0]).toMatchObject({
			action: "comment.hardDelete",
			entityId: c.id,
			entityName: "Rover",
		})
	})

	test("vote add and same-kind cancel each record an event with the kind", async () => {
		const c = await svc.create({ body: "Takeaway" })
		actions.length = 0

		const added = await svc.addVote({ commentId: c.id, kind: "like" })
		expect(added.action).toBe("added")
		expect(actions[0]).toMatchObject({
			action: "comment.vote.add",
			entityId: c.id,
			entityName: "Takeaway",
			detail: { kind: "like" },
		})

		// Same-kind click inside the window cancels.
		const cancelled = await svc.addVote({ commentId: c.id, kind: "like" })
		expect(cancelled.action).toBe("cancelled")
		expect(actions[1]).toMatchObject({
			action: "comment.vote.cancel",
			detail: { kind: "like" },
		})
	})

	test("vote swap inside the window records an event with the new kind", async () => {
		const c = await svc.create({ body: "Takeaway" })
		await svc.addVote({ commentId: c.id, kind: "like" })
		actions.length = 0

		const swapped = await svc.addVote({ commentId: c.id, kind: "dislike" })
		expect(swapped.action).toBe("swapped")
		expect(actions).toHaveLength(1)
		expect(actions[0]).toMatchObject({
			action: "comment.vote.swap",
			entityId: c.id,
			entityName: "Takeaway",
			detail: { kind: "dislike" },
		})
	})
})
