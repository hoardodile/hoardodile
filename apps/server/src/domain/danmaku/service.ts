import type { PluginRegistry } from "@hoardodile/host"
import { createCapabilityGuard } from "@hoardodile/host"
import type {
	Danmaku,
	DanmakuCreateInput,
	DanmakuDeleteInput,
	DanmakuListInput,
	DanmakuMode,
	ResAnchor,
	ResAnchorFilter,
} from "@hoardodile/schemas"
import { asc, eq, type SQL } from "drizzle-orm"
import { buildFindById, buildRemove } from "src/infra/db/builders.ts"
import type { SqliteDb } from "src/infra/db/connection.ts"
import { type ClockDeps, resolveClock, wrapAsync } from "src/infra/service.ts"
import { resources } from "../res/schema.ts"
import { danmakus } from "./schema.ts"

export type DanmakuServiceDeps = ClockDeps & {
	readonly db: SqliteDb
	/**
	 * Live accessor for the current plugin registry — called per request so
	 * a plugin rescan never leaves this service holding a stale registry.
	 */
	readonly getRegistry?: () => PluginRegistry
}

/**
 * Behaviour contract for the danmaku module.
 *
 * `list` returns every danmaku scoped to a resource. Plugin-specific
 * location filtering (page, timestamp, paragraph) happens client-side
 * through the plugin render module.
 */
export type DanmakuService = {
	list(input: DanmakuListInput): Promise<readonly Danmaku[]>
	create(input: DanmakuCreateInput): Promise<Danmaku>
	delete(input: DanmakuDeleteInput): Promise<void>
}

export function createDanmakuService(deps: DanmakuServiceDeps): DanmakuService {
	const { db } = deps
	const { now, newId } = resolveClock(deps)
	const guard = createCapabilityGuard()
	const findById = buildFindById<typeof danmakus.$inferSelect>(
		db,
		danmakus,
		"danmaku",
	)
	const remove = buildRemove(db, danmakus)

	function list(input: DanmakuListInput): readonly Danmaku[] {
		const rows = db
			.select()
			.from(danmakus)
			.where(buildAnchorWhere(input.anchor))
			.orderBy(asc(danmakus.createdAt))
			.all()
		return rows.map(rowToDanmaku)
	}

	function create(input: DanmakuCreateInput): Danmaku {
		const resRow = db
			.select({ contentPluginId: resources.contentPluginId })
			.from(resources)
			.where(eq(resources.id, input.anchorResId))
			.get()
		if (resRow !== undefined && resRow.contentPluginId !== null) {
			const pluginEntry = deps.getRegistry?.().getById(resRow.contentPluginId)
			if (pluginEntry !== undefined) {
				guard.require(pluginEntry.manifest, "danmaku")
			}
		}
		const id = newId()
		const ts = now()
		db.insert(danmakus)
			.values({
				id,
				anchorResourceId: input.anchorResId,
				anchorData: JSON.stringify(input.anchor),
				text: input.text,
				color: input.color ?? "",
				mode: input.mode ?? "scroll",
				createdAt: ts,
			})
			.run()
		return rowToDanmaku(findById(id))
	}

	function deleteOne(input: DanmakuDeleteInput): void {
		findById(input.id)
		remove(input.id)
	}

	return wrapAsync({
		list,
		create,
		delete: deleteOne,
	})
}

function buildAnchorWhere(filter: ResAnchorFilter): SQL | undefined {
	return eq(danmakus.anchorResourceId, filter.resId)
}

function rowToDanmaku(row: typeof danmakus.$inferSelect): Danmaku {
	const anchor = parseAnchor(row.anchorData, row.anchorResourceId)
	return {
		id: row.id,
		anchor,
		text: row.text,
		color: row.color,
		mode: row.mode satisfies DanmakuMode,
		createdAt: row.createdAt,
	}
}

function parseAnchor(raw: string, resId: string): ResAnchor {
	// Pre-normalization rows carry a redundant top-level resId inside the
	// JSON; the column is always the authority.
	const parsed = JSON.parse(raw) as { data?: unknown }
	return { resId, data: parsed.data }
}
