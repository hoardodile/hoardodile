import type { PluginManifest } from "@hoardodile/sdk-types"
import { eq } from "drizzle-orm"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { contentPlugins } from "./schema.ts"
import { createPluginSettingsStore } from "./settings-store.ts"

const ID = "11111111-1111-4111-8111-111111111111"

function buildManifest(): PluginManifest {
	return {
		id: ID,
		name: "Settings Store Test",
		description: "adapter fixture",
		version: "1.0.0",
		permissions: {
			sourceMeta: false,
			searchMeta: false,
			danmaku: false,
			message: false,
			imageHashes: false,
			container: false,
			download: false,
		},
	}
}

describe("createPluginSettingsStore", () => {
	let dbh: DbHandles

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
	})

	afterEach(() => {
		dbh.close()
	})

	test("get returns undefined for an unknown plugin", () => {
		const store = createPluginSettingsStore(dbh.db)
		expect(store.get(ID)).toBeUndefined()
	})

	test("get normalizes the DB row to booleans and plain values", () => {
		const now = Date.now()
		dbh.db
			.insert(contentPlugins)
			.values({
				id: ID,
				manifest: JSON.stringify(buildManifest()),
				enabled: 1,
				priority: 200,
				pinned: 0,
				color: "#ff0000",
				missing: 0,
				createdAt: now,
				updatedAt: now,
			})
			.run()

		const store = createPluginSettingsStore(dbh.db)
		expect(store.get(ID)).toEqual({
			id: ID,
			manifest: expect.any(String) as unknown as string,
			enabled: true,
			priority: 200,
			pinned: false,
			color: "#ff0000",
		})
	})

	test("all returns every row, including disabled and pinned ones", () => {
		const now = Date.now()
		const secondId = "22222222-2222-4222-8222-222222222222"
		const manifest = JSON.stringify(buildManifest())
		for (const [id, enabled, pinned] of [
			[ID, 1, 1],
			[secondId, 0, 0],
		] as const) {
			dbh.db
				.insert(contentPlugins)
				.values({
					id,
					manifest,
					enabled,
					priority: 100,
					pinned,
					color: "",
					missing: 0,
					createdAt: now,
					updatedAt: now,
				})
				.run()
		}

		const store = createPluginSettingsStore(dbh.db)
		const rows = store.all()
		expect(rows).toHaveLength(2)
		const first = rows.find((r) => r.id === ID)
		expect(first?.enabled).toBe(true)
		expect(first?.pinned).toBe(true)
		const second = rows.find((r) => r.id === secondId)
		expect(second?.enabled).toBe(false)
		expect(second?.pinned).toBe(false)
	})

	test("updates are visible to subsequent reads", () => {
		const now = Date.now()
		dbh.db
			.insert(contentPlugins)
			.values({
				id: ID,
				manifest: JSON.stringify(buildManifest()),
				enabled: 1,
				priority: 100,
				pinned: 0,
				color: "",
				missing: 0,
				createdAt: now,
				updatedAt: now,
			})
			.run()

		dbh.db
			.update(contentPlugins)
			.set({ enabled: 0 })
			.where(eq(contentPlugins.id, ID))
			.run()

		const store = createPluginSettingsStore(dbh.db)
		expect(store.get(ID)?.enabled).toBe(false)
	})
})
