import { randomUUID } from "node:crypto"
import { DomainError } from "@hoardodile/shared"
import { buildCharacterRepository } from "src/domain/char/repo.ts"
import { buildResourceRepository } from "src/domain/res/repo.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { type CommentService, createCommentService } from "./service.ts"

describe("commentService", () => {
	let dbh: DbHandles
	let svc: CommentService

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		svc = createCommentService({ db: dbh.db })
	})

	afterEach(() => {
		dbh.close()
	})

	test("list returns top-level comments with replyCount", async () => {
		const root = await svc.create({ body: "root" })
		await svc.create({ body: "reply1", parentId: root.id })
		await svc.create({ body: "reply2", parentId: root.id })

		const listed = await svc.list({})
		expect(listed.rows).toHaveLength(1)
		expect(listed.rows[0]?.id).toBe(root.id)
		expect(listed.rows[0]?.replyCount).toBe(2)
		expect(listed.total).toBe(1)
		expect(listed.totalAll).toBe(3)
	})

	test("totalAll excludes trashed replies from live counts", async () => {
		const root = await svc.create({ body: "root" })
		const reply = await svc.create({ body: "reply", parentId: root.id })
		await svc.softDelete(reply.id)

		const listed = await svc.list({})
		expect(listed.total).toBe(1)
		expect(listed.totalAll).toBe(1)
	})

	test("totalAll counts replies linked to the same character", async () => {
		const charRepo = buildCharacterRepository(dbh.db)
		const charId = randomUUID()
		const ts = Date.now()
		charRepo.insert(
			charId,
			{ name: "A", intro: "", traitValues: "", tagIds: [] },
			ts,
			1,
		)

		const root = await svc.create({ body: "root", charIds: [charId] })
		await svc.create({ body: "reply", parentId: root.id, charIds: [charId] })

		const listed = await svc.list({ charId })
		expect(listed.total).toBe(1)
		expect(listed.totalAll).toBe(2)
	})

	test("thread returns replies with proper parentId", async () => {
		const root = await svc.create({ body: "root" })
		const r1 = await svc.create({ body: "reply1", parentId: root.id })
		const r2 = await svc.create({ body: "deep", parentId: r1.id })

		const detail = await svc.thread({ id: root.id })
		expect(detail.comment.id).toBe(root.id)
		expect(detail.replies).toHaveLength(2)
		const ids = detail.replies.map((r) => r.id)
		expect(ids).toContain(r1.id)
		expect(ids).toContain(r2.id)
		const reply1 = detail.replies.find((r) => r.id === r1.id)
		expect(reply1?.parentId).toBe(root.id)
		const reply2 = detail.replies.find((r) => r.id === r2.id)
		expect(reply2?.parentId).toBe(r1.id)
	})

	test("create persists character and resource links atomically", async () => {
		const charRepo = buildCharacterRepository(dbh.db)
		const resRepo = buildResourceRepository(dbh.db)
		const charA = randomUUID()
		const charB = randomUUID()
		const resId = randomUUID()
		const ts = Date.now()
		charRepo.insert(
			charA,
			{ name: "A", intro: "", traitValues: "", tagIds: [] },
			ts,
			1,
		)
		charRepo.insert(
			charB,
			{ name: "B", intro: "", traitValues: "", tagIds: [] },
			ts,
			1,
		)
		resRepo.insert(
			resId,
			{
				name: "Res",
				intro: "",
				contentPluginId: null,
				tagIds: [],
				charIds: [],
			},
			ts,
			1,
		)

		const comment = await svc.create({
			body: "linked",
			charIds: [charA, charB],
			resIds: [resId],
		})

		const detail = await svc.thread({ id: comment.id })
		expect(new Set(detail.comment.charIds)).toEqual(new Set([charA, charB]))
		expect(detail.comment.resIds).toEqual([resId])
	})

	test("addVote swap replaces the previous vote", async () => {
		const comment = await svc.create({ body: "vote me" })
		const first = await svc.addVote({ commentId: comment.id, kind: "like" })
		expect(first.action).toBe("added")
		expect(first.vote?.kind).toBe("like")

		const swapped = await svc.addVote({
			commentId: comment.id,
			kind: "dislike",
		})
		expect(swapped.action).toBe("swapped")
		expect(swapped.vote?.kind).toBe("dislike")

		const votes = await svc.listVotesFor(comment.id)
		expect(votes).toHaveLength(1)
		expect(votes[0]?.kind).toBe("dislike")
	})

	test("assigns sequential archived floor numbers to top-level comments", async () => {
		const first = await svc.create({ body: "first" })
		const second = await svc.create({ body: "second" })
		const third = await svc.create({ body: "third" })

		expect(first.floor).toBe(1)
		expect(second.floor).toBe(2)
		expect(third.floor).toBe(3)
	})

	test("replies omit floor numbers", async () => {
		const root = await svc.create({ body: "root" })
		const reply = await svc.create({ body: "reply", parentId: root.id })

		expect(root.floor).toBe(1)
		expect(reply.floor).toBeUndefined()
	})

	test("floor numbers stay stable across sort and search filters", async () => {
		await svc.create({ body: "alpha thread" })
		const beta = await svc.create({ body: "beta thread" })
		await svc.create({ body: "reply", parentId: beta.id })
		await svc.addVote({ commentId: beta.id, kind: "like" })

		const byLikes = await svc.list({ sortBy: "mostLikes" })
		expect(byLikes.rows.map((row) => row.floor)).toEqual([2, 1])

		const filtered = await svc.list({ query: "alpha" })
		expect(filtered.rows).toHaveLength(1)
		expect(filtered.rows[0]?.floor).toBe(1)
	})

	test("soft delete, restore, and hard delete lifecycle", async () => {
		const root = await svc.create({ body: "root" })
		const reply = await svc.create({ body: "reply", parentId: root.id })

		const trashed = await svc.softDelete(root.id)
		expect(trashed.deletedAt).toBeTypeOf("number")
		expect((await svc.list({})).rows).toHaveLength(0)
		expect((await svc.list({ trashed: true })).rows.map((r) => r.id)).toEqual([
			root.id,
		])

		const restored = await svc.restore(root.id)
		expect(restored.deletedAt).toBeUndefined()
		expect((await svc.list({})).rows.map((r) => r.id)).toEqual([root.id])

		await svc.softDelete(root.id)
		await svc.hardDelete(root.id)
		await expect(svc.thread({ id: reply.id })).rejects.toThrow(DomainError)
	})

	test("hardDelete refuses unless the row is already soft-deleted", async () => {
		const comment = await svc.create({ body: "live" })
		await expect(svc.hardDelete(comment.id)).rejects.toThrow(DomainError)
	})

	test("thread fullContext returns live and trashed replies", async () => {
		const root = await svc.create({ body: "root" })
		const liveReply = await svc.create({ body: "live", parentId: root.id })
		const trashedReply = await svc.create({
			body: "trashed",
			parentId: root.id,
		})
		await svc.softDelete(trashedReply.id)

		const detail = await svc.thread({ id: root.id, fullContext: true })
		expect(detail.comment.id).toBe(root.id)
		const ids = detail.replies.map((r) => r.id)
		expect(ids).toContain(liveReply.id)
		expect(ids).toContain(trashedReply.id)
		expect(
			detail.replies.find((r) => r.id === trashedReply.id)?.deletedAt,
		).toBeTypeOf("number")
	})
})
