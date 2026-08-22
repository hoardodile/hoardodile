import type { CharCard, DocNode, ResCard } from "@hoardodile/schemas"
import dayjs from "@hoardodile/shared/dayjs"
import { eq } from "drizzle-orm"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { characters } from "../char/schema.ts"
import type { CharService } from "../char/service.ts"
import { docResLinks, documents } from "../doc/schema.ts"
import { createDocumentService, type DocService } from "../doc/service.ts"
import { resCharacters, resources } from "../res/schema.ts"
import type { ResService } from "../res/service.ts"
import { getDayBounds } from "./lib/time.ts"
import { usageSessionAssociations, usageSessions } from "./schema.ts"
import { createUsageService, type UsageService } from "./service.ts"

describe("usageService", () => {
	let dbh: DbHandles
	let svc: UsageService
	let docSvc: DocService
	let nowMs: number
	let ids: [
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
		string,
	]

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		nowMs = 1_000_000
		ids = Array.from(
			{ length: 10 },
			(_, i) => `id-${String(i).padStart(2, "0")}`,
		) as [
			string,
			string,
			string,
			string,
			string,
			string,
			string,
			string,
			string,
			string,
		]
		svc = createUsageService({
			db: dbh.db,
			now: () => nowMs,
			newId: () => `uid-${nowMs++}`,
		})
		docSvc = createDocumentService({ db: dbh.db })
	})

	afterEach(() => {
		dbh.close()
	})

	function beat(
		entityType: "resource" | "character" | "document" | "plugin",
		entityId: string,
		durationMs: number,
		startedAt = nowMs - durationMs,
		sessionId = `session-${entityId}`,
		platform?: "web-mobile" | "web-pc" | "desktop",
	) {
		return svc.recordSessionBeat({
			sessionId,
			entityType,
			entityId,
			startedAt,
			durationMs,
			platform,
		})
	}

	test("clearAll removes all usage data", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")
		await beat("resource", resId, 60_000)

		await svc.clearAll()

		const totals = await svc.getTotals({
			entityType: "resource",
			granularity: "all",
			order: "time",
			limit: 10,
		})
		expect(totals).toHaveLength(0)

		const dashboard = await svc.getDashboard()
		expect(dashboard.totalMs).toBe(0)
		expect(dashboard.totalViews).toBe(0)
	})

	test("getTotals order views ranks by session count", async () => {
		const [resLong, resManyViews] = ids
		insertResource(resLong, "plugin-a")
		insertResource(resManyViews, "plugin-a")

		await beat("resource", resLong, 120_000, nowMs - 120_000, "session-long")
		await beat("resource", resManyViews, 10_000, nowMs - 30_000, "session-v1")
		await beat("resource", resManyViews, 10_000, nowMs - 20_000, "session-v2")
		await beat("resource", resManyViews, 10_000, nowMs - 10_000, "session-v3")

		const byTime = await svc.getTotals({
			entityType: "resource",
			granularity: "all",
			order: "time",
			limit: 5,
		})
		expect(byTime[0]?.entityId).toBe(resLong)
		expect(byTime[0]?.viewCount).toBe(1)

		const byViews = await svc.getTotals({
			entityType: "resource",
			granularity: "all",
			order: "views",
			limit: 5,
		})
		expect(byViews[0]?.entityId).toBe(resManyViews)
		expect(byViews[0]?.viewCount).toBe(3)
		expect(byViews[1]?.entityId).toBe(resLong)
	})

	test("getTotals clips sessions to explicit from/to bounds", async () => {
		const [resInside, resOutside] = ids
		insertResource(resInside, "plugin-a")
		insertResource(resOutside, "plugin-a")

		await beat("resource", resInside, 60_000, nowMs - 60_000, "session-inside")
		await beat(
			"resource",
			resOutside,
			60_000,
			nowMs - 2_000_000,
			"session-outside",
		)

		const totals = await svc.getTotals({
			entityType: "resource",
			granularity: "all",
			from: nowMs - 1_000_000,
			to: nowMs,
			order: "time",
			limit: 10,
		})
		expect(totals.map((row) => row.entityId)).toEqual([resInside])
		expect(totals[0]?.totalMs).toBe(60_000)
	})

	test("records resource session without inflating linked characters", async () => {
		const [resId, charId, pluginId] = ids
		insertResource(resId, pluginId)
		insertCharacter(charId)
		linkResourceCharacter(resId, charId)

		await beat("resource", resId, 60_000)

		const resTotal = await svc.getTotals({
			entityType: "resource",
			granularity: "all",
			order: "time",
			limit: 1,
		})
		expect(resTotal[0]?.totalMs).toBe(60_000)
		expect(resTotal[0]?.viewCount).toBe(1)

		const charTotal = await svc.getTotals({
			entityType: "character",
			granularity: "all",
			order: "time",
			limit: 1,
		})
		expect(charTotal).toHaveLength(0)

		const dashboard = await svc.getDashboard()
		expect(dashboard.totalMs).toBe(60_000)
		expect(dashboard.totalViews).toBe(1)
	})

	test("multiple beats extend the same session", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		await beat("resource", resId, 10_000, 0, "session-a")
		await beat("resource", resId, 25_000, 0, "session-a")

		const total = await svc.getTotals({
			entityType: "resource",
			granularity: "all",
			order: "time",
			limit: 1,
		})
		expect(total[0]?.totalMs).toBe(25_000)
		expect(total[0]?.viewCount).toBe(1)
	})

	test("records document session without inflating linked resources", async () => {
		const [docId, resId, charId] = ids
		insertDocument(docId)
		insertResource(resId, "plugin-a")
		insertCharacter(charId)
		await docSvc.patchDraft({
			id: docId,
			content: {
				version: 4,
				blocks: [
					{
						type: "paragraph",
						content: [
							{
								type: "charChip",
								props: { charId, fallbackName: "Char" },
							},
							{ type: "resCard", props: { resId } },
						],
					},
				],
			},
		})

		await beat("document", docId, 30_000)

		const docTotal = await svc.getTotals({
			entityType: "document",
			granularity: "all",
			order: "time",
			limit: 1,
		})
		expect(docTotal[0]?.totalMs).toBe(30_000)

		const resTotal = await svc.getTotals({
			entityType: "resource",
			granularity: "all",
			order: "time",
			limit: 1,
		})
		expect(resTotal).toHaveLength(0)

		const charTotal = await svc.getTotals({
			entityType: "character",
			granularity: "all",
			order: "time",
			limit: 1,
		})
		expect(charTotal).toHaveLength(0)
	})

	test("records document associations from draft columns, not committed link tables", async () => {
		const [docId, resId, charId, otherResId] = ids
		insertDocument(docId)
		insertResource(resId, "plugin-a")
		insertResource(otherResId, "plugin-a")
		insertCharacter(charId)

		// Pre-populate committed link tables with an old association.
		// The usage service should ignore these and read from the draft columns.
		linkDocumentResource(docId, otherResId)

		await docSvc.patchDraft({
			id: docId,
			content: {
				version: 4,
				blocks: [
					{
						type: "paragraph",
						content: [
							{
								type: "charChip",
								props: { charId, fallbackName: "Char" },
							},
							{ type: "resCard", props: { resId } },
						],
					},
				],
			},
		})

		await beat("document", docId, 30_000)

		const associations = dbh.db
			.select({
				entityType: usageSessionAssociations.entityType,
				entityId: usageSessionAssociations.entityId,
			})
			.from(usageSessionAssociations)
			.where(eq(usageSessionAssociations.sessionId, `session-${docId}`))
			.all()
		const associationKeys = associations.map((a) => ({
			entityType: a.entityType,
			entityId: a.entityId,
		}))

		expect(associationKeys).toContainEqual({
			entityType: "resource",
			entityId: resId,
		})
		expect(associationKeys).toContainEqual({
			entityType: "character",
			entityId: charId,
		})
		expect(associationKeys).not.toContainEqual({
			entityType: "resource",
			entityId: otherResId,
		})
	})

	test("dashboard aggregates primary sessions only", async () => {
		const [resId, charId] = ids
		insertResource(resId, "plugin-a")
		insertCharacter(charId)
		linkResourceCharacter(resId, charId)

		await beat("resource", resId, 60_000)
		await beat("character", charId, 30_000)

		const dashboard = await svc.getDashboard()
		expect(dashboard.totalMs).toBe(90_000)
		expect(dashboard.totalViews).toBe(2)
		expect(dashboard.topResources).toHaveLength(1)
		expect(dashboard.topCharacters).toHaveLength(1)
	})

	test("recommendations continue returns recently viewed resources and documents", async () => {
		const [resId, docId] = ids
		insertResource(resId, "plugin-a")
		insertDocument(docId)

		const recSvc = createUsageService({
			db: dbh.db,
			now: () => nowMs,
			newId: () => `uid-${nowMs++}`,
			...makeResolverMocks(),
		})

		await recSvc.recordSessionBeat({
			sessionId: "s1",
			entityType: "resource",
			entityId: resId,
			startedAt: nowMs - 60_000,
			durationMs: 60_000,
		})
		await recSvc.recordSessionBeat({
			sessionId: "s2",
			entityType: "document",
			entityId: docId,
			startedAt: nowMs - 60_000,
			durationMs: 60_000,
		})

		const continueRecs = await recSvc.getRecommendations({
			kind: "continue",
			limit: 10,
			timeZone: "UTC",
		})
		expect(continueRecs).toHaveLength(2)
		expect(continueRecs.map((r) => r.entityId).sort()).toEqual(
			[resId, docId].sort(),
		)

		// Skip past the 7-day window — nothing should be suggested.
		nowMs += 8 * 24 * 60 * 60 * 1000
		const empty = await recSvc.getRecommendations({
			kind: "continue",
			limit: 10,
			timeZone: "UTC",
		})
		expect(empty).toHaveLength(0)
	})

	test("recommendations top picks scores resources and characters by recency", async () => {
		const [resId, charId] = ids
		insertResource(resId, "plugin-a")
		insertCharacter(charId)

		const recSvc = createUsageService({
			db: dbh.db,
			now: () => nowMs,
			newId: () => `uid-${nowMs++}`,
			...makeResolverMocks(),
		})

		await recSvc.recordSessionBeat({
			sessionId: "s1",
			entityType: "resource",
			entityId: resId,
			startedAt: nowMs - 60_000,
			durationMs: 60_000,
		})
		await recSvc.recordSessionBeat({
			sessionId: "s2",
			entityType: "character",
			entityId: charId,
			startedAt: nowMs - 60_000,
			durationMs: 60_000,
		})

		const top = await recSvc.getRecommendations({
			kind: "topPicks",
			limit: 10,
			timeZone: "UTC",
		})
		expect(top).toHaveLength(2)
	})

	function insertResource(id: string, pluginId: string) {
		dbh.db
			.insert(resources)
			.values({
				id,
				name: `Resource ${id}`,
				intro: "",
				contentPluginId: pluginId,
				fileVersion: 1,
				coverVersion: 1,
				createdAt: nowMs,
				updatedAt: nowMs,
			})
			.run()
	}

	function insertCharacter(id: string) {
		dbh.db
			.insert(characters)
			.values({
				id,
				name: `Character ${id}`,
				intro: "",
				avatarVersion: 1,
				fullbodyVersion: 1,
				createdAt: nowMs,
				updatedAt: nowMs,
			})
			.run()
	}

	function insertDocument(id: string) {
		dbh.db
			.insert(documents)
			.values({
				id,
				kind: "document",
				title: `Document ${id}`,
				createdAt: nowMs,
				updatedAt: nowMs,
			})
			.run()
	}

	function linkResourceCharacter(resId: string, charId: string) {
		dbh.db.insert(resCharacters).values({ resId, charId }).run()
	}

	function linkDocumentResource(docId: string, resId: string) {
		dbh.db.insert(docResLinks).values({ docId, resId }).run()
	}

	test("timeline returns sessions with associations", async () => {
		const [resId, charId, pluginId] = ids
		insertResource(resId, pluginId)
		insertCharacter(charId)
		linkResourceCharacter(resId, charId)

		await beat("resource", resId, 60_000)

		const timeline = await svc.getTimeline({ limit: 10 })
		expect(timeline).toHaveLength(1)
		expect(timeline[0]?.entityType).toBe("resource")
		expect(timeline[0]?.entityId).toBe(resId)
		expect(timeline[0]?.durationMs).toBe(60_000)
		expect(timeline[0]?.associations).toHaveLength(2)
		const associatedKinds = timeline[0]?.associations.map((a) => ({
			entityType: a.entityType,
			associationKind: a.associationKind,
		}))
		expect(associatedKinds).toContainEqual({
			entityType: "character",
			associationKind: "linked",
		})
		expect(associatedKinds).toContainEqual({
			entityType: "plugin",
			associationKind: "owner",
		})
	})

	test("dailySummary aggregates sessions for a day", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		const day = formatDay(nowMs, "UTC")
		await beat("resource", resId, 60_000, nowMs - 60_000)

		const summary = await svc.getDailySummary({
			date: day,
			limit: 5,
			timeZone: "UTC",
		})
		expect(summary.date).toBe(day)
		expect(summary.totalMs).toBe(60_000)
		expect(summary.sessionCount).toBe(1)
		expect(summary.topEntities).toHaveLength(1)
		expect(summary.topEntities[0]?.entityId).toBe(resId)
		expect(summary.hourlyMs.reduce((a, b) => a + b, 0)).toBeGreaterThan(0)
	})

	test("dailySummary excludes sessions starting exactly at period end", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		const day = "2026-06-15"
		const { end: dayEnd } = getDayBounds(day, "UTC")

		await svc.recordSessionBeat({
			sessionId: "s-boundary",
			entityType: "resource",
			entityId: resId,
			startedAt: dayEnd,
			durationMs: 60_000,
		})

		const summary = await svc.getDailySummary({
			date: day,
			limit: 5,
			timeZone: "UTC",
		})
		expect(summary.totalMs).toBe(0)
		expect(summary.sessionCount).toBe(0)
	})

	test("entityExposure splits direct and associated time", async () => {
		const [resId, charId, pluginId] = ids
		insertResource(resId, pluginId)
		insertCharacter(charId)
		linkResourceCharacter(resId, charId)

		await beat("resource", resId, 60_000)
		await beat("character", charId, 30_000)

		const charExposure = await svc.getEntityExposure({
			entityType: "character",
			entityId: charId,
		})
		expect(charExposure.directMs).toBe(30_000)
		expect(charExposure.associatedMs).toBe(60_000)
		expect(charExposure.totalMs).toBe(90_000)
		expect(charExposure.viewCount).toBe(1)
		expect(charExposure.sessionCount).toBe(2)
	})

	test("entityExposure viewCount is zero when only associated", async () => {
		const [resId, charId, pluginId] = ids
		insertResource(resId, pluginId)
		insertCharacter(charId)
		linkResourceCharacter(resId, charId)

		await beat("resource", resId, 60_000)

		const charExposure = await svc.getEntityExposure({
			entityType: "character",
			entityId: charId,
		})
		expect(charExposure.viewCount).toBe(0)
		expect(charExposure.associatedMs).toBe(60_000)
		expect(charExposure.directMs).toBe(0)
	})

	test("getTotals exposureMode associated ranks linked characters", async () => {
		const [resId, charId, pluginId] = ids
		insertResource(resId, pluginId)
		insertCharacter(charId)
		linkResourceCharacter(resId, charId)

		await beat("resource", resId, 60_000)

		const directTotals = await svc.getTotals({
			entityType: "character",
			granularity: "all",
			order: "time",
			limit: 5,
			exposureMode: "direct",
		})
		expect(directTotals).toHaveLength(0)

		const associatedTotals = await svc.getTotals({
			entityType: "character",
			granularity: "all",
			order: "time",
			limit: 5,
			exposureMode: "associated",
		})
		expect(associatedTotals[0]?.entityId).toBe(charId)
		expect(associatedTotals[0]?.totalMs).toBe(60_000)

		const totalTotals = await svc.getTotals({
			entityType: "character",
			granularity: "all",
			order: "time",
			limit: 5,
			exposureMode: "total",
		})
		expect(totalTotals[0]?.entityId).toBe(charId)
		expect(totalTotals[0]?.totalMs).toBe(60_000)
	})

	test("records platform on sessions", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		await beat("resource", resId, 60_000, nowMs - 60_000, "s1", "web-pc")
		await beat("resource", resId, 30_000, nowMs - 30_000, "s2", "web-mobile")

		const sessions = dbh.db.select().from(usageSessions).all()
		expect(sessions.map((row) => row.platform)).toEqual([
			"web-pc",
			"web-mobile",
		])
	})

	test("filters totals and dashboard by platform", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		await svc.recordSessionBeat({
			sessionId: "session-pc",
			entityType: "resource",
			entityId: resId,
			startedAt: nowMs - 60_000,
			durationMs: 60_000,
			platform: "web-pc",
		})
		await svc.recordSessionBeat({
			sessionId: "session-mobile",
			entityType: "resource",
			entityId: resId,
			startedAt: nowMs - 30_000,
			durationMs: 30_000,
			platform: "web-mobile",
		})

		const pcTotals = await svc.getTotals({
			entityType: "resource",
			granularity: "all",
			order: "time",
			limit: 1,
			platform: "web-pc",
		})
		expect(pcTotals[0]?.totalMs).toBe(60_000)

		const mobileTotals = await svc.getTotals({
			entityType: "resource",
			granularity: "all",
			order: "time",
			limit: 1,
			platform: "web-mobile",
		})
		expect(mobileTotals[0]?.totalMs).toBe(30_000)

		const dashboard = await svc.getDashboard({ platform: "web-mobile" })
		expect(dashboard.totalMs).toBe(30_000)
		expect(dashboard.totalViews).toBe(1)
	})

	test("beats without platform keep platform null", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		await beat("resource", resId, 60_000)

		const sessions = dbh.db.select().from(usageSessions).all()
		expect(sessions[0]?.platform).toBeNull()
	})

	test("monotonic guard ignores stale beats", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		await svc.recordSessionBeat({
			sessionId: "s1",
			entityType: "resource",
			entityId: resId,
			startedAt: nowMs - 60_000,
			durationMs: 60_000,
		})
		await svc.recordSessionBeat({
			sessionId: "s1",
			entityType: "resource",
			entityId: resId,
			startedAt: nowMs - 60_000,
			durationMs: 30_000,
		})

		const total = await svc.getTotals({
			entityType: "resource",
			granularity: "all",
			order: "time",
			limit: 1,
		})
		expect(total[0]?.totalMs).toBe(60_000)
	})

	test("dailySummary splits hours by time zone", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		// 2026-06-15 00:00 Asia/Shanghai = 2026-06-14 16:00 UTC
		const shanghaiMidnight = Date.UTC(2026, 5, 14, 16, 0, 0)
		const sessionStart = shanghaiMidnight - 30 * 60 * 1000
		const sessionEnd = shanghaiMidnight + 30 * 60 * 1000
		await svc.recordSessionBeat({
			sessionId: "s1",
			entityType: "resource",
			entityId: resId,
			startedAt: sessionStart,
			durationMs: sessionEnd - sessionStart,
		})

		const summary = await svc.getDailySummary({
			date: "2026-06-15",
			limit: 5,
			timeZone: "Asia/Shanghai",
		})
		// Only the 00:00-00:30 portion belongs to June 15 in Shanghai time.
		expect(summary.totalMs).toBe(30 * 60 * 1000)
		expect(summary.hourlyMs).toHaveLength(24)
		expect(summary.hourlyLabels).toHaveLength(24)
		expect(summary.hourlyMs[0]).toBe(30 * 60 * 1000)
		expect(summary.hourlyMs[23]).toBe(0)
	})

	test("hourlyWindow averages the window's hourly totals per day", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		const dayStart = 86_400_000
		const tenAm = dayStart + 10 * 3_600_000
		for (const [index, start] of [tenAm, tenAm + 86_400_000].entries()) {
			await svc.recordSessionBeat({
				sessionId: `s-day${index}`,
				entityType: "resource",
				entityId: resId,
				startedAt: start,
				durationMs: 30 * 60 * 1000,
			})
		}

		const window = await svc.getHourlyWindow({
			from: dayStart,
			to: dayStart + 7 * 86_400_000,
			timeZone: "UTC",
		})
		expect(window.dayCount).toBe(7)
		expect(window.hourlyMs).toHaveLength(24)
		// Two 30-minute sessions at 10:00 across seven days.
		expect(window.hourlyMs[10]).toBe(Math.round((2 * 30 * 60 * 1000) / 7))
		expect(window.hourlyMs[9]).toBe(0)
	})

	test("hourlyWindow over one day matches the daily summary", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")
		await svc.recordSessionBeat({
			sessionId: "s1",
			entityType: "resource",
			entityId: resId,
			startedAt: nowMs - 30 * 60 * 1000,
			durationMs: 30 * 60 * 1000,
		})

		const day = formatDay(nowMs, "UTC")
		const { start, end } = getDayBounds(day, "UTC")
		const summary = await svc.getDailySummary({
			date: day,
			limit: 5,
			timeZone: "UTC",
		})
		const window = await svc.getHourlyWindow({
			from: start,
			to: end,
			timeZone: "UTC",
		})
		expect(window.dayCount).toBe(1)
		expect(window.hourlyMs).toEqual(summary.hourlyMs)
	})

	test("hourlyWindow without bounds starts at the earliest session", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")
		await svc.recordSessionBeat({
			sessionId: "s-old",
			entityType: "resource",
			entityId: resId,
			startedAt: nowMs - 3 * 86_400_000,
			durationMs: 60_000,
		})
		await beat("resource", resId, 60_000, nowMs - 60_000, "s-now")

		const window = await svc.getHourlyWindow({ timeZone: "UTC" })
		// The earliest session's day through today — four calendar days.
		expect(window.dayCount).toBe(4)
		expect(window.hourlyMs.reduce((sum, ms) => sum + ms, 0)).toBeGreaterThan(0)
	})

	test("hourlyWindow ignores sessions outside the window", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")
		await svc.recordSessionBeat({
			sessionId: "s-before",
			entityType: "resource",
			entityId: resId,
			startedAt: 86_400_000 - 3_600_000,
			durationMs: 3_600_000,
		})

		const window = await svc.getHourlyWindow({
			from: 86_400_000,
			to: 3 * 86_400_000,
			timeZone: "UTC",
		})
		expect(window.dayCount).toBe(2)
		expect(window.hourlyMs.every((ms) => ms === 0)).toBe(true)
	})

	test("hourlyWindow over a long window averages across all days", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		const windowStart = 86_400_000
		const windowEnd = windowStart + 30 * 86_400_000
		for (let day = 0; day < 30; day++) {
			await svc.recordSessionBeat({
				sessionId: `s-day-${day}`,
				entityType: "resource",
				entityId: resId,
				startedAt: windowStart + day * 86_400_000 + 8 * 3_600_000,
				durationMs: 30 * 60 * 1000,
			})
		}

		const window = await svc.getHourlyWindow({
			from: windowStart,
			to: windowEnd,
			timeZone: "UTC",
		})
		expect(window.dayCount).toBe(30)
		// 30 × 30 minutes at 08:00 across 30 days.
		expect(window.hourlyMs[8]).toBe(Math.round((30 * 30 * 60 * 1000) / 30))
		expect(window.hourlyMs.reduce((sum, ms) => sum + ms, 0)).toBe(
			window.hourlyMs[8]!,
		)
	})

	test("trend returns daily buckets for last 7 days", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		const today = formatDay(nowMs, "UTC")
		await beat("resource", resId, 60_000, nowMs - 60_000, "session-today")

		const trend = await svc.getTrend({
			granularity: "day",
			periods: 7,
			timeZone: "UTC",
		})
		expect(trend.buckets).toHaveLength(7)
		const todayBucket = trend.buckets.find((b) => b.period === today)
		expect(todayBucket?.totalMs).toBe(60_000)
	})

	test("trend clips sessions across bucket boundaries into both buckets", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		// 23:30 Dec 31 1969 – 00:30 Jan 1 1970: 30min in each day bucket.
		await svc.recordSessionBeat({
			sessionId: "s-cross",
			entityType: "resource",
			entityId: resId,
			startedAt: Date.UTC(1969, 11, 31, 23, 30, 0),
			durationMs: 60 * 60 * 1000,
		})

		const trend = await svc.getTrend({
			granularity: "day",
			periods: 2,
			timeZone: "UTC",
		})
		expect(trend.buckets).toHaveLength(2)
		const [previous, current] = trend.buckets
		expect(previous?.period).toBe("1969-12-31")
		expect(previous?.totalMs).toBe(30 * 60 * 1000)
		expect(previous?.sessionCount).toBe(1)
		expect(current?.period).toBe("1970-01-01")
		expect(current?.totalMs).toBe(30 * 60 * 1000)
		expect(current?.sessionCount).toBe(1)
	})

	test("trend excludes sessions outside the window", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		await beat(
			"resource",
			resId,
			60_000,
			Date.UTC(1969, 11, 30, 12, 0, 0),
			"s-old",
		)

		const trend = await svc.getTrend({
			granularity: "day",
			periods: 1,
			timeZone: "UTC",
		})
		expect(trend.buckets[0]?.totalMs).toBe(0)
		expect(trend.buckets[0]?.sessionCount).toBe(0)
	})

	test("trend filters by entity type", async () => {
		const [resId, charId] = ids
		insertResource(resId, "plugin-a")
		insertCharacter(charId)

		await beat("resource", resId, 60_000, nowMs - 60_000, "s-res")
		await beat("character", charId, 60_000, nowMs - 60_000, "s-char")

		const trend = await svc.getTrend({
			granularity: "day",
			periods: 1,
			entityType: "resource",
			timeZone: "UTC",
		})
		expect(trend.buckets[0]?.totalMs).toBe(60_000)
		expect(trend.buckets[0]?.sessionCount).toBe(1)
	})

	test("trend filters by platform", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		await beat("resource", resId, 60_000, nowMs - 120_000, "s-pc", "web-pc")
		await beat(
			"resource",
			resId,
			60_000,
			nowMs - 60_000,
			"s-mobile",
			"web-mobile",
		)

		const trend = await svc.getTrend({
			granularity: "day",
			periods: 1,
			platform: "web-pc",
			timeZone: "UTC",
		})
		expect(trend.buckets[0]?.totalMs).toBe(60_000)
		expect(trend.buckets[0]?.sessionCount).toBe(1)
	})

	test("trend with year granularity splits across calendar years", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		await svc.recordSessionBeat({
			sessionId: "s-1969",
			entityType: "resource",
			entityId: resId,
			startedAt: Date.UTC(1969, 11, 30, 12, 0, 0),
			durationMs: 60_000,
		})
		await beat(
			"resource",
			resId,
			60_000,
			Date.UTC(1970, 0, 1, 0, 10, 0),
			"s-1970",
		)

		const trend = await svc.getTrend({
			granularity: "year",
			periods: 2,
			timeZone: "UTC",
		})
		expect(trend.buckets).toHaveLength(2)
		const [previousYear, currentYear] = trend.buckets
		expect(previousYear?.period).toBe("1969")
		expect(previousYear?.totalMs).toBe(60_000)
		expect(currentYear?.period).toBe("1970")
		expect(currentYear?.totalMs).toBe(60_000)
		expect(currentYear?.sessionCount).toBe(1)
	})

	test("hourlyWindow buckets by local wall hours in a DST zone", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		const from = Date.UTC(2026, 5, 10, 4, 0, 0) // Jun 10 00:00 EDT
		const to = from + 6 * 86_400_000
		for (let day = 0; day < 5; day++) {
			await svc.recordSessionBeat({
				sessionId: `s-day-${day}`,
				entityType: "resource",
				entityId: resId,
				startedAt: Date.UTC(2026, 5, 10 + day, 13, 0, 0), // 09:00 EDT
				durationMs: 30 * 60 * 1000,
			})
		}

		const window = await svc.getHourlyWindow({
			from,
			to,
			timeZone: "America/New_York",
		})
		expect(window.dayCount).toBe(6)
		// 5 × 30min at 09:00 local across 6 calendar days.
		expect(window.hourlyMs[9]).toBe(Math.round((5 * 30 * 60 * 1000) / 6))
		expect(window.hourlyMs.reduce((sum, ms) => sum + ms, 0)).toBe(
			window.hourlyMs[9]!,
		)
	})

	test("hourlyWindow repeats the fall-back hour", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		const from = Date.UTC(2026, 10, 1, 4, 0, 0) // Nov 1 00:00 EDT
		const to = Date.UTC(2026, 10, 3, 4, 0, 0) // Nov 3 00:00 EST
		await svc.recordSessionBeat({
			sessionId: "s-fallback",
			entityType: "resource",
			entityId: resId,
			startedAt: Date.UTC(2026, 10, 1, 5, 30, 0), // 01:30 EDT
			durationMs: 2 * 3_600_000, // ends 02:30 EST
		})

		const window = await svc.getHourlyWindow({
			from,
			to,
			timeZone: "America/New_York",
		})
		expect(window.dayCount).toBe(2)
		// 30min at 01:30 EDT + 60min of the repeated 01:00 EST → hour 1;
		// the remaining 30min falls into hour 2.
		expect(window.hourlyMs[1]).toBe(Math.round((90 * 60 * 1000) / 2))
		expect(window.hourlyMs[2]).toBe(Math.round((30 * 60 * 1000) / 2))
	})

	test("hourlyWindow buckets by a non-hour offset zone", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		const from = Date.UTC(2026, 5, 14, 18, 15, 0) // Jun 15 00:00 NPT
		const to = Date.UTC(2026, 5, 15, 18, 15, 0) // Jun 16 00:00 NPT
		await svc.recordSessionBeat({
			sessionId: "s-kath",
			entityType: "resource",
			entityId: resId,
			startedAt: Date.UTC(2026, 5, 15, 4, 30, 0), // 10:15 NPT
			durationMs: 60 * 60 * 1000,
		})

		const window = await svc.getHourlyWindow({
			from,
			to,
			timeZone: "Asia/Kathmandu",
		})
		expect(window.dayCount).toBe(1)
		expect(window.hourlyMs[10]).toBe(45 * 60 * 1000)
		expect(window.hourlyMs[11]).toBe(15 * 60 * 1000)
	})

	test("hourlyWindow filters by platform", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		const from = Date.UTC(2026, 5, 10, 0, 0, 0)
		const to = Date.UTC(2026, 5, 11, 0, 0, 0)
		await beat(
			"resource",
			resId,
			30 * 60 * 1000,
			from + 9 * 3_600_000,
			"s-pc",
			"web-pc",
		)
		await beat(
			"resource",
			resId,
			30 * 60 * 1000,
			from + 9 * 3_600_000,
			"s-mobile",
			"web-mobile",
		)

		const window = await svc.getHourlyWindow({
			from,
			to,
			timeZone: "UTC",
			platform: "web-pc",
		})
		expect(window.hourlyMs[9]).toBe(30 * 60 * 1000)
		expect(window.hourlyMs.reduce((sum, ms) => sum + ms, 0)).toBe(
			30 * 60 * 1000,
		)
	})

	test("dailySummary splits the repeated hour on a fall-back day", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		const timeZone = "America/New_York"
		await svc.recordSessionBeat({
			sessionId: "s-fallback",
			entityType: "resource",
			entityId: resId,
			startedAt: Date.UTC(2026, 10, 1, 5, 30, 0), // 01:30 EDT
			durationMs: 2 * 3_600_000, // ends 02:30 EST
		})

		const summary = await svc.getDailySummary({
			date: "2026-11-01",
			limit: 5,
			timeZone,
		})
		expect(summary.hourlyMs).toHaveLength(25)
		// 01:00 EDT, the repeated 01:00 EST, and 02:00 EST are distinct buckets.
		expect(summary.hourlyMs[1]).toBe(30 * 60 * 1000)
		expect(summary.hourlyMs[2]).toBe(60 * 60 * 1000)
		expect(summary.hourlyMs[3]).toBe(30 * 60 * 1000)
		expect(summary.hourlyMs.reduce((sum, ms) => sum + ms, 0)).toBe(
			2 * 3_600_000,
		)
	})

	test("periodSummary aggregates a month", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		await beat("resource", resId, 60_000, nowMs - 60_000, "session-a")

		const month = formatMonth(nowMs, "UTC")
		const summary = await svc.getPeriodSummary({
			granularity: "month",
			period: month,
			limit: 5,
			timeZone: "UTC",
		})
		expect(summary.totalMs).toBe(60_000)
		expect(summary.topEntities[0]?.entityId).toBe(resId)
	})

	test("listTotals supports day granularity", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		await beat("resource", resId, 60_000, nowMs - 60_000, "session-a")

		const day = formatDay(nowMs, "UTC")
		const totals = await svc.getTotals({
			entityType: "resource",
			granularity: "day",
			period: day,
			order: "time",
			limit: 1,
			timeZone: "UTC",
		})
		expect(totals[0]?.totalMs).toBe(60_000)
		expect(totals[0]?.period).toBe(day)
	})

	test("listTotals clips cross-midnight sessions to match dailySummary", async () => {
		const [resId] = ids
		insertResource(resId, "plugin-a")

		const shanghaiMidnight = Date.UTC(2026, 5, 14, 16, 0, 0)
		const sessionStart = shanghaiMidnight - 30 * 60 * 1000
		const sessionEnd = shanghaiMidnight + 30 * 60 * 1000
		await svc.recordSessionBeat({
			sessionId: "s1",
			entityType: "resource",
			entityId: resId,
			startedAt: sessionStart,
			durationMs: sessionEnd - sessionStart,
		})

		const timeZone = "Asia/Shanghai"
		const date = "2026-06-15"
		const summary = await svc.getDailySummary({
			date,
			limit: 5,
			timeZone,
		})
		const totals = await svc.getTotals({
			entityType: "resource",
			granularity: "day",
			period: date,
			order: "time",
			limit: 1,
			timeZone,
		})
		const periodSummary = await svc.getPeriodSummary({
			granularity: "day",
			period: date,
			limit: 1,
			timeZone,
		})

		expect(totals[0]?.totalMs).toBe(30 * 60 * 1000)
		expect(totals[0]?.totalMs).toBe(summary.totalMs)
		expect(periodSummary.totalMs).toBe(summary.totalMs)
	})

	test("listTotals clips associated exposure for day granularity", async () => {
		const [resId, charId, pluginId] = ids
		insertResource(resId, pluginId)
		insertCharacter(charId)
		linkResourceCharacter(resId, charId)

		const shanghaiMidnight = Date.UTC(2026, 5, 14, 16, 0, 0)
		const sessionStart = shanghaiMidnight - 30 * 60 * 1000
		const sessionEnd = shanghaiMidnight + 30 * 60 * 1000
		await svc.recordSessionBeat({
			sessionId: "s1",
			entityType: "resource",
			entityId: resId,
			startedAt: sessionStart,
			durationMs: sessionEnd - sessionStart,
		})

		const timeZone = "Asia/Shanghai"
		const date = "2026-06-15"
		const associatedTotals = await svc.getTotals({
			entityType: "character",
			granularity: "day",
			period: date,
			order: "time",
			limit: 1,
			timeZone,
			exposureMode: "associated",
		})
		const totalTotals = await svc.getTotals({
			entityType: "character",
			granularity: "day",
			period: date,
			order: "time",
			limit: 1,
			timeZone,
			exposureMode: "total",
		})

		expect(associatedTotals[0]?.entityId).toBe(charId)
		expect(associatedTotals[0]?.totalMs).toBe(30 * 60 * 1000)
		expect(totalTotals[0]?.totalMs).toBe(30 * 60 * 1000)
	})

	test("getTotalsPage returns paged totals", async () => {
		let index = 0
		for (const resId of ids) {
			insertResource(resId, "plugin-a")
			await beat("resource", resId, (index + 1) * 60_000)
			index++
		}

		const page1 = await svc.getTotalsPage({
			entityType: "resource",
			granularity: "all",
			order: "time",
			limit: 5,
			page: 1,
		})
		expect(page1.rows).toHaveLength(5)
		expect(page1.total).toBe(ids.length)
		expect(page1.page).toBe(1)
		expect(page1.size).toBe(5)
		expect(page1.rows[0]?.entityId).toBe(ids[ids.length - 1])

		const page2 = await svc.getTotalsPage({
			entityType: "resource",
			granularity: "all",
			order: "time",
			limit: 5,
			page: 2,
		})
		expect(page2.rows).toHaveLength(5)
		expect(page2.total).toBe(ids.length)
		expect(page2.page).toBe(2)
		expect(page2.rows[0]?.entityId).toBe(ids[ids.length - 6])
	})

	function formatMonth(ts: number, timeZone: string): string {
		return dayjs(ts).tz(timeZone).format("YYYY-MM")
	}

	function formatDay(ts: number, timeZone: string): string {
		return dayjs(ts).tz(timeZone).format("YYYY-MM-DD")
	}

	function makeResolverMocks(): {
		resService: ResService
		charService: CharService
		docService: DocService
	} {
		return {
			resService: {
				detailCard: async (id: string) =>
					({
						id,
						name: `Resource ${id}`,
						intro: "",
						contentPluginId: "gallery",
						pinnedTags: [],
						characters: [],
						collections: [],
						createdAt: nowMs,
						updatedAt: nowMs,
					}) as unknown as ResCard,
			} as unknown as ResService,
			charService: {
				detailCard: async (id: string) =>
					({
						id,
						name: `Character ${id}`,
						intro: "",
						pinnedTags: [],
						relations: [],
						createdAt: nowMs,
						updatedAt: nowMs,
					}) as unknown as CharCard,
			} as unknown as CharService,
			docService: {
				detail: async (id: string) =>
					({
						id,
						kind: "document",
						title: `Document ${id}`,
						position: 0,
						createdAt: nowMs,
						updatedAt: nowMs,
					}) as unknown as DocNode,
			} as unknown as DocService,
		}
	}

	test("getTotals excludes soft-deleted and hard-deleted resources", async () => {
		const [resAlive, resSoftDeleted, resHardDeleted] = ids
		insertResource(resAlive, "plugin-a")
		insertResource(resSoftDeleted, "plugin-a")
		insertResource(resHardDeleted, "plugin-a")

		await beat("resource", resAlive, 60_000)
		await beat("resource", resSoftDeleted, 50_000)
		await beat("resource", resHardDeleted, 40_000)

		dbh.db
			.update(resources)
			.set({ deletedAt: nowMs })
			.where(eq(resources.id, resSoftDeleted))
			.run()
		dbh.db.delete(resources).where(eq(resources.id, resHardDeleted)).run()

		const totals = await svc.getTotals({
			entityType: "resource",
			granularity: "all",
			order: "time",
			limit: 10,
		})
		expect(totals).toHaveLength(1)
		expect(totals[0]?.entityId).toBe(resAlive)
	})

	test("getTotals excludes deleted characters and documents", async () => {
		const [charAlive, charDeleted, docAlive, docDeleted] = ids
		insertCharacter(charAlive)
		insertCharacter(charDeleted)
		insertDocument(docAlive)
		insertDocument(docDeleted)

		await beat("character", charAlive, 60_000)
		await beat("character", charDeleted, 50_000)
		await beat("document", docAlive, 60_000)
		await beat("document", docDeleted, 50_000)

		dbh.db
			.update(characters)
			.set({ deletedAt: nowMs })
			.where(eq(characters.id, charDeleted))
			.run()
		dbh.db
			.update(documents)
			.set({ deletedAt: nowMs })
			.where(eq(documents.id, docDeleted))
			.run()

		const charTotals = await svc.getTotals({
			entityType: "character",
			granularity: "all",
			order: "time",
			limit: 10,
		})
		expect(charTotals.map((t) => t.entityId)).toEqual([charAlive])

		const docTotals = await svc.getTotals({
			entityType: "document",
			granularity: "all",
			order: "time",
			limit: 10,
		})
		expect(docTotals.map((t) => t.entityId)).toEqual([docAlive])
	})

	test("getTotalsPage returns correct total and rows after filtering", async () => {
		const [resAlive, resDeleted] = ids
		insertResource(resAlive, "plugin-a")
		insertResource(resDeleted, "plugin-a")

		await beat("resource", resAlive, 60_000)
		await beat("resource", resDeleted, 50_000)

		dbh.db
			.update(resources)
			.set({ deletedAt: nowMs })
			.where(eq(resources.id, resDeleted))
			.run()

		const page = await svc.getTotalsPage({
			entityType: "resource",
			granularity: "all",
			order: "time",
			limit: 10,
			page: 1,
		})
		expect(page.total).toBe(1)
		expect(page.rows).toHaveLength(1)
		expect(page.rows[0]?.entityId).toBe(resAlive)
	})

	test("dailySummary topEntities exclude deleted resources", async () => {
		const [resAlive, resDeleted] = ids
		insertResource(resAlive, "plugin-a")
		insertResource(resDeleted, "plugin-a")

		const day = formatDay(nowMs, "UTC")
		await beat("resource", resAlive, 60_000, nowMs - 60_000)
		await beat("resource", resDeleted, 50_000, nowMs - 50_000)

		dbh.db
			.update(resources)
			.set({ deletedAt: nowMs })
			.where(eq(resources.id, resDeleted))
			.run()

		const summary = await svc.getDailySummary({
			date: day,
			limit: 10,
			timeZone: "UTC",
		})
		expect(summary.topEntities).toHaveLength(1)
		expect(summary.topEntities[0]?.entityId).toBe(resAlive)
	})

	test("periodSummary topEntities exclude deleted resources", async () => {
		const [resAlive, resDeleted] = ids
		insertResource(resAlive, "plugin-a")
		insertResource(resDeleted, "plugin-a")

		const month = formatMonth(nowMs, "UTC")
		await beat("resource", resAlive, 60_000)
		await beat("resource", resDeleted, 50_000)

		dbh.db
			.update(resources)
			.set({ deletedAt: nowMs })
			.where(eq(resources.id, resDeleted))
			.run()

		const summary = await svc.getPeriodSummary({
			granularity: "month",
			period: month,
			limit: 10,
			timeZone: "UTC",
		})
		expect(summary.topEntities).toHaveLength(1)
		expect(summary.topEntities[0]?.entityId).toBe(resAlive)
	})

	test("dashboard top lists exclude deleted resources", async () => {
		const [resAlive, resDeleted] = ids
		insertResource(resAlive, "plugin-a")
		insertResource(resDeleted, "plugin-a")

		await beat("resource", resAlive, 60_000)
		await beat("resource", resDeleted, 50_000)

		dbh.db
			.update(resources)
			.set({ deletedAt: nowMs })
			.where(eq(resources.id, resDeleted))
			.run()

		const dashboard = await svc.getDashboard()
		expect(dashboard.topResources).toHaveLength(1)
		expect(dashboard.topResources[0]?.entityId).toBe(resAlive)
	})
})
