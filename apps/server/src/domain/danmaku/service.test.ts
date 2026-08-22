import { randomUUID } from "node:crypto"
import type { PluginRegistry } from "@hoardodile/host"
import { buildRegistry } from "@hoardodile/host"
import type { PluginManifestId } from "@hoardodile/sdk-types"
import { buildResourceRepository } from "src/domain/res/repo.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { afterEach, beforeEach, describe, expect, test } from "vitest"
import { createDanmakuService } from "./service.ts"

const PLUGIN_ID = "11111111-1111-4111-8111-111111111111" as PluginManifestId

function registryWithDanmakuPermission(granted: boolean): PluginRegistry {
	return buildRegistry([
		{
			id: PLUGIN_ID,
			manifest: {
				id: PLUGIN_ID,
				name: "Test",
				description: "",
				version: "1.0.0",
				permissions: {
					sourceMeta: false,
					searchMeta: false,
					danmaku: granted,
					message: false,
					imageHashes: false,
				},
			},
			enabled: true,
			priority: 100,
			pinned: false,
			color: "",
			missing: false,
			builtin: false,
			dev: false,
			plugin: { detect: async () => ({ ok: true }) },
		},
	])
}

describe("danmakuService plugin capability", () => {
	let dbh: DbHandles
	let resId: string

	beforeEach(() => {
		dbh = openDb(":memory:")
		dbh.runMigrations()
		resId = randomUUID()
		buildResourceRepository(dbh.db).insert(
			resId,
			{
				name: "res",
				intro: "",
				contentPluginId: PLUGIN_ID,
				tagIds: [],
				charIds: [],
			},
			Date.now(),
			1,
		)
	})

	afterEach(() => {
		dbh.close()
	})

	test("getRegistry is re-read per call — a rescan swapping the registry takes effect immediately", async () => {
		let current = registryWithDanmakuPermission(true)
		const svc = createDanmakuService({
			db: dbh.db,
			getRegistry: () => current,
		})

		await expect(
			svc.create({
				anchor: { data: undefined },
				anchorResId: resId,
				text: "hello",
			}),
		).resolves.toMatchObject({ text: "hello" })

		// Simulate a rescan: the loader hands out a NEW registry object.
		// A service capturing the old object would keep allowing danmaku.
		current = registryWithDanmakuPermission(false)

		await expect(
			svc.create({
				anchor: { data: undefined },
				anchorResId: resId,
				text: "denied",
			}),
		).rejects.toThrow(/danmaku permission denied/)
	})
})
