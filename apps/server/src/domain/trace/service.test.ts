import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { runWithDeviceContext } from "src/infra/trpc/device-context.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createTraceService, type TraceService } from "./service.ts"

describe("trace service", () => {
	let dbh: DbHandles
	let svc: TraceService
	let nowMs: number
	let idSeq: number

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		nowMs = 1_000
		idSeq = 0
		svc = createTraceService({
			db: dbh.db,
			now: () => nowMs,
			newId: () => `evt-${String(idSeq++).padStart(3, "0")}`,
		})
	})

	afterEach(() => {
		dbh.close()
	})

	test("record appends one immutable row with the name snapshot", async () => {
		svc.record({
			action: "resource.import",
			entityType: "resource",
			entityId: "res-1",
			entityName: "Model A",
			detail: { sourceName: "Some Site" },
		})
		const page = await svc.timeline({})
		expect(page.rows).toHaveLength(1)
		expect(page.total).toBe(1)
		expect(page.rows[0]).toMatchObject({
			action: "resource.import",
			entityType: "resource",
			entityId: "res-1",
			entityName: "Model A",
			detail: { sourceName: "Some Site" },
			createdAt: 1_000,
		})
	})

	test("timeline returns newest-first and pages without gaps on equal timestamps", async () => {
		nowMs = 5_000
		svc.record({
			action: "resource.import",
			entityType: "resource",
			entityId: "a",
			entityName: "A",
		})
		svc.record({
			action: "resource.export",
			entityType: "resource",
			entityId: "b",
			entityName: "B",
		})
		svc.record({
			action: "resource.softDelete",
			entityType: "resource",
			entityId: "c",
			entityName: "C",
		})

		const first = await svc.timeline({ page: 1, limit: 2 })
		expect(first.rows.map((r) => r.entityId)).toEqual(["c", "b"])
		expect(first.total).toBe(3)

		const second = await svc.timeline({ page: 2, limit: 2 })
		expect(second.rows.map((r) => r.entityId)).toEqual(["a"])
		expect(second.total).toBe(3)

		const ids = [...first.rows, ...second.rows].map((r) => r.id)
		expect(new Set(ids).size).toBe(3)
	})

	test("timeline pages beyond the last page return no rows", async () => {
		svc.record({
			action: "resource.import",
			entityType: "resource",
			entityId: "a",
			entityName: "A",
		})
		const page = await svc.timeline({ page: 3, limit: 2 })
		expect(page.rows).toHaveLength(0)
		expect(page.total).toBe(1)
	})

	test("timeline filters by action", async () => {
		svc.record({
			action: "resource.import",
			entityType: "resource",
			entityId: "a",
			entityName: "A",
		})
		svc.record({
			action: "resource.export",
			entityType: "resource",
			entityId: "b",
			entityName: "B",
		})
		const page = await svc.timeline({ action: "resource.export" })
		expect(page.rows).toHaveLength(1)
		expect(page.rows[0]?.entityId).toBe("b")
	})

	test("timeline filters by entity type and reports the matching total", async () => {
		svc.record({
			action: "resource.import",
			entityType: "resource",
			entityId: "a",
			entityName: "A",
		})
		svc.record({
			action: "comment.create",
			entityType: "comment",
			entityId: "m1",
			entityName: "M",
		})
		svc.record({
			action: "document.commit",
			entityType: "document",
			entityId: "d1",
			entityName: "D",
		})
		const all = await svc.timeline({})
		expect(all.total).toBe(3)
		const page = await svc.timeline({ entityType: "comment", limit: 1 })
		expect(page.rows.map((r) => r.entityId)).toEqual(["m1"])
		expect(page.total).toBe(1)
	})

	test("records the ambient request platform and filters by it", async () => {
		runWithDeviceContext({ headers: { "x-platform": "web-mobile" } }, () => {
			svc.record({
				action: "resource.import",
				entityType: "resource",
				entityId: "a",
				entityName: "A",
			})
		})
		svc.record({
			action: "resource.export",
			entityType: "resource",
			entityId: "b",
			entityName: "B",
		})
		const page = await svc.timeline({ platform: "web-mobile" })
		expect(page.rows.map((r) => r.entityId)).toEqual(["a"])
		expect(page.rows[0]?.platform).toBe("web-mobile")
		expect(page.total).toBe(1)
		// Rows recorded outside a request context fall back to web-pc.
		const fallback = await svc.timeline({ platform: "web-pc" })
		expect(fallback.rows.map((r) => r.entityId)).toEqual(["b"])
	})

	test("clearAll wipes every event", async () => {
		svc.record({
			action: "resource.import",
			entityType: "resource",
			entityId: "a",
			entityName: "A",
		})
		await svc.clearAll()
		const page = await svc.timeline({})
		expect(page.rows).toHaveLength(0)
	})

	test("report buckets events into periods and groups by action", async () => {
		// Fixed UTC clock: 2026-06-14T12:00:00Z (a Sunday).
		nowMs = Date.UTC(2026, 5, 14, 12, 0, 0)
		svc.record({
			action: "resource.import",
			entityType: "resource",
			entityId: "a",
			entityName: "A",
		})
		// Earlier the same day.
		nowMs = Date.UTC(2026, 5, 14, 8, 0, 0)
		svc.record({
			action: "resource.import",
			entityType: "resource",
			entityId: "b",
			entityName: "B",
		})
		svc.record({
			action: "resource.export",
			entityType: "resource",
			entityId: "c",
			entityName: "C",
		})
		// Yesterday (outside the trailing window when period=1).
		nowMs = Date.UTC(2026, 5, 13, 23, 0, 0)
		svc.record({
			action: "comment.create",
			entityType: "comment",
			entityId: "m1",
			entityName: "Comment A",
		})
		nowMs = Date.UTC(2026, 5, 14, 12, 0, 0)

		const report = await svc.report({
			granularity: "day",
			periods: 2,
			timeZone: "UTC",
		})
		expect(report).toHaveLength(2)
		// Oldest period first, matching the usage trend convention.
		expect(report[0]?.period).toBe("2026-06-13")
		expect(report[0]?.rows).toEqual([{ action: "comment.create", count: 1 }])
		expect(report[1]?.period).toBe("2026-06-14")
		expect(report[1]?.rows).toEqual(
			expect.arrayContaining([
				{ action: "resource.import", count: 2 },
				{ action: "resource.export", count: 1 },
			]),
		)
	})

	test("report filters by action", async () => {
		nowMs = Date.UTC(2026, 5, 14, 12, 0, 0)
		svc.record({
			action: "resource.import",
			entityType: "resource",
			entityId: "a",
			entityName: "A",
		})
		svc.record({
			action: "resource.export",
			entityType: "resource",
			entityId: "b",
			entityName: "B",
		})
		const report = await svc.report({
			granularity: "day",
			periods: 1,
			timeZone: "UTC",
			action: "resource.export",
		})
		expect(report[0]?.rows).toEqual([{ action: "resource.export", count: 1 }])
	})

	test("report filters by platform", async () => {
		nowMs = Date.UTC(2026, 5, 14, 12, 0, 0)
		runWithDeviceContext({ headers: { "x-platform": "web-mobile" } }, () => {
			svc.record({
				action: "resource.import",
				entityType: "resource",
				entityId: "a",
				entityName: "A",
			})
		})
		svc.record({
			action: "resource.export",
			entityType: "resource",
			entityId: "b",
			entityName: "B",
		})
		const report = await svc.report({
			granularity: "day",
			periods: 1,
			timeZone: "UTC",
			platform: "web-mobile",
		})
		expect(report[0]?.rows).toEqual([{ action: "resource.import", count: 1 }])
	})
})
