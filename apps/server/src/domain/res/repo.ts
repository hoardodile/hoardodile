import type {
	CoverMeta,
	FileStats,
	HashesMeta,
	ResCard,
	Resource,
	SearchMeta,
	SourceMetaBase,
} from "@hoardodile/schemas"
import {
	COVER_KINDS,
	type CoverKind,
	coverMeta as coverMetaSchema,
	fileStats as fileStatsSchema,
	hashesMeta as hashesMetaSchema,
	isEmptyMeta,
	RESOURCE_DISLIKE_CANCEL_WINDOW_MS,
	searchMeta as searchMetaSchema,
	sourceMetaBase,
} from "@hoardodile/schemas"
import type { SortBy, SortOrder, TagFilterMode } from "@hoardodile/shared"
import { produce } from "@hoardodile/shared/immer"
import {
	and,
	asc,
	count,
	desc,
	eq,
	exists,
	gt,
	inArray,
	isNotNull,
	isNull,
	ne,
	not,
	or,
	sql,
} from "drizzle-orm"
import { categories } from "src/domain/cat/schema.ts"
import { characters } from "src/domain/char/schema.ts"
import { resCollectionItems, resCollections } from "src/domain/col/schema.ts"
import {
	collapsePinnedTags,
	loadSiblingPairs,
	withPinnedVirtualTags,
} from "src/domain/tag/collapse.ts"
import { buildTagFilterClauses } from "src/domain/tag/filter.ts"
import { resTags, tags } from "src/domain/tag/schema.ts"
import {
	buildFindById,
	buildHydrate,
	buildRemove,
} from "src/infra/db/builders.ts"
import type { DbClient } from "src/infra/db/connection.ts"
import { likeContainsLower } from "./like.ts"
import {
	resCharacters,
	resourceDislikes,
	resourceHashes,
	resourceMeta,
	resources,
} from "./schema.ts"

type ResourceCore = typeof resources.$inferSelect
type ResourceMetaRow = typeof resourceMeta.$inferSelect
type ResourceDislikeRow = typeof resourceDislikes.$inferSelect

/**
 * A resource row already hydrated with derived meta and join rows.
 * Consumers (service layer) treat this as the canonical DB row shape.
 */
export type ResRow = ResourceCore & {
	readonly coverMeta: string | null
	readonly sourceMeta: string | null
	readonly searchMeta: string | null
	readonly fileStats: string | null
	readonly hashesMeta: string | null
	readonly tagIds: readonly string[]
	readonly charIds: readonly string[]
	/** Total dislike-click rows on the resource. */
	readonly dislikeCount: number
	/** Whether the newest dislike row is still inside its cancel window. */
	readonly dislikedRecently: boolean
}

export type ResDbValues = {
	readonly name: string
	readonly intro: string
	readonly sourceName?: string | null
	readonly sourceUrl?: string | null
	readonly contentPluginId: string | null
	readonly tagIds: readonly string[]
	readonly charIds: readonly string[]
}

export type ResDbPatch = Partial<
	Pick<
		typeof resources.$inferInsert,
		| "name"
		| "intro"
		| "sourceName"
		| "sourceUrl"
		| "contentPluginId"
		| "deletedAt"
		| "updatedAt"
		| "coverVersion"
	>
>

export type ResMetaPatch = Partial<
	Pick<
		typeof resourceMeta.$inferInsert,
		"coverMeta" | "sourceMeta" | "searchMeta" | "fileStats" | "hashesMeta"
	>
>

/** One row of the `resource_hashes` table. */
export type ResourceHashRow = typeof resourceHashes.$inferSelect

/** Bare hash row as stored, minus resource id (caller context supplies it). */
export type HashEntry = {
	readonly scope: string
	readonly type: string
	readonly value: string
	readonly bits: number | null
}

/**
 * Join updates. `undefined` means "leave alone"; an array (even empty)
 * means "replace the full set".
 */
export type ResJoinPatch = {
	readonly tagIds?: readonly string[]
	readonly charIds?: readonly string[]
}

export type ResListQuery = {
	readonly trashed: boolean
	readonly query: string | undefined
	readonly page: number
	readonly size: number
	readonly charIds?: readonly string[]
	readonly noCharacters?: boolean
	readonly tagIds?: readonly string[]
	readonly tagMode?: TagFilterMode
	/** When set, restricts results to resources in any of these collections. */
	readonly colIds?: readonly string[]
	readonly sortBy?: SortBy
	readonly order?: SortOrder
	readonly random?: boolean
	/**
	 * Seed for deterministic random ordering; only read when
	 * {@link random} is true. See {@link ListPageInput.seed}.
	 */
	readonly seed?: string
	readonly contentPluginId?: string
	/**
	 * When set, restricts results to rows whose user-set source name
	 * equals this value (exact match, case-sensitive).
	 */
	readonly sourceName?: string
	/**
	 * When set, restricts results to rows whose `searchMeta.facets`
	 * contains at least one of the listed keys with a truthy value.
	 * OR semantics across keys.
	 */
	readonly searchMetaFacets?: Record<string, boolean>
	/** When true, the free-text query also matches `intro`. Defaults to false (name-only). */
	readonly searchIntro?: boolean
	/** Restrict results to rows whose id is in this set. */
	readonly ids?: readonly string[]
	/**
	 * When `true`, restricts results to resources that have at least one
	 * dislike row.
	 */
	readonly dislikedOnly?: boolean
}

export type ResRowPage = {
	readonly rows: readonly ResRow[]
	readonly total: number
}

/** Enriched row returned by {@link ResRepository.listCardPage}. */
export type ResCardRow = ResRow & {
	readonly pinnedTags: readonly {
		readonly id: string
		readonly name: string
		readonly color: string
	}[]
	readonly characters: readonly {
		readonly id: string
		readonly name: string
		readonly updatedAt: number
	}[]
	readonly collections: readonly {
		readonly id: string
		readonly name: string
		readonly color: string
	}[]
}

export type ResCardRowPage = {
	readonly rows: readonly ResCardRow[]
	readonly total: number
}

/** One distinct user-set source name with its live-resource usage count. */
export type SourceNameCount = {
	readonly name: string
	readonly count: number
}

/**
 * "On this day" query parameters. `month`/`day` are the user's local
 * calendar day (computed client-side from the `timeZone` preference);
 * `offsetMin` is the current UTC offset in minutes so the server can
 * interpret `createdAt` in the same calendar day.
 */
export type ResMemoriesQuery = {
	readonly month: number
	readonly day: number
	readonly offsetMin: number
	readonly limit: number
}

/**
 * Pure Drizzle query layer for the resource module. No file-system
 * operations; no domain business rules. The service layer calls these
 * functions and handles invariant enforcement, row-to-domain mapping, and
 * coordination with the file layer.
 */
export type ResRepository = {
	/** @throws {DomainError} NOT_FOUND when the row is missing. */
	findById(id: string): ResRow
	/** Like {@link findById} but also pre-computes `pinnedTags` + `characters`. */
	findCardById(id: string): ResCardRow
	listPage(query: ResListQuery): ResRowPage
	/**
	 * Like {@link listPage} but each row also carries pre-computed
	 * `pinnedTags` and `characters` - fetched in batch queries, not N+1.
	 * A tag is included when `tag.pinned = true` OR its `category.pinned = true`.
	 */
	listCardPage(query: ResListQuery): ResCardRowPage
	/**
	 * Live resources whose `createdAt` month-day (in the user's offset)
	 * matches the query, from years before the current one, most recent
	 * first, capped at `limit`. Drives the overview "on this day" block.
	 */
	memories(query: ResMemoriesQuery): readonly ResCardRow[]
	/**
	 * Distinct user-set source names across live resources, most used
	 * first, capped at `limit`. Feeds the list-page source filter and the
	 * form autocomplete.
	 */
	listSourceNames(limit: number): readonly SourceNameCount[]
	insert(id: string, values: ResDbValues, ts: number, fileVersion: number): void
	patch(id: string, fields: ResDbPatch, joins?: ResJoinPatch): void
	patchMeta(id: string, fields: ResMetaPatch, builtAt: number): void
	remove(id: string): void
	/** Set all rebuildable meta columns to NULL on every row. */
	clearAllMeta(): void
	/** Live resources currently bound to the given content plugin. */
	countByContentPluginId(pluginId: string): number
	/** Replace every hash row of the resource with `entries` (empty clears). */
	replaceHashes(
		resourceId: string,
		pluginId: string,
		entries: readonly HashEntry[],
	): void
	/** All hash rows of one resource. */
	listHashes(resourceId: string): readonly ResourceHashRow[]
	/**
	 * Rows of the given kind across live resources, for similarity scans.
	 * `excludeResourceId`, when given, is dropped (a resource never
	 * matches itself); query-image scans pass none.
	 */
	listHashesOfType(
		type: string,
		excludeResourceId?: string,
	): readonly ResourceHashRow[]
	/**
	 * Exact-match lookup: other live resources holding `value` under
	 * `type`. Excludes the resource itself.
	 */
	findExactHashMatches(
		type: string,
		value: string,
		excludeResourceId: string,
	): readonly ResourceHashRow[]
	/** Add one dislike-click row. */
	insertDislike(id: string, resourceId: string, ts: number): void
	/** Remove one dislike row (only legal inside the cancel window). */
	deleteDislike(id: string): void
	/** Most recent dislike row of the resource, or `undefined` when none. */
	findLatestDislike(resourceId: string): ResourceDislikeRow | undefined
	/** All dislike rows of the resource, newest first. */
	listDislikes(resourceId: string): readonly ResourceDislikeRow[]
}

export function buildResourceRepository(
	client: DbClient,
	nowFn: () => number = Date.now,
): ResRepository {
	const findCoreById = buildFindById<ResourceCore>(
		client,
		resources,
		"resource",
	)
	const remove = buildRemove(client, resources)
	const attachTagIds = buildHydrate(
		client,
		resTags,
		resTags.resId,
		resTags.tagId,
		"tagIds" as const,
	)
	const attachCharacterIds = buildHydrate(
		client,
		resCharacters,
		resCharacters.resId,
		resCharacters.charId,
		"charIds" as const,
	)

	function mergeMeta(
		core: ResourceCore,
		meta: ResourceMetaRow | undefined,
	): Omit<ResRow, "tagIds" | "charIds" | "dislikeCount" | "dislikedRecently"> {
		return {
			...core,
			coverMeta: meta?.coverMeta ?? null,
			sourceMeta: meta?.sourceMeta ?? null,
			searchMeta: meta?.searchMeta ?? null,
			fileStats: meta?.fileStats ?? null,
			hashesMeta: meta?.hashesMeta ?? null,
		}
	}

	function loadMetaByIds(ids: readonly string[]): Map<string, ResourceMetaRow> {
		if (ids.length === 0) return new Map()
		const rows = client
			.select()
			.from(resourceMeta)
			.where(inArray(resourceMeta.resourceId, ids))
			.all()
		return new Map(rows.map((row) => [row.resourceId, row]))
	}

	/** Batch dislike stats for a set of resource ids, two indexed queries. */
	function loadDislikeStats(
		ids: readonly string[],
	): Map<string, { count: number; recently: boolean }> {
		if (ids.length === 0) return new Map()
		const countRows = client
			.select({
				resourceId: resourceDislikes.resourceId,
				total: count(),
			})
			.from(resourceDislikes)
			.where(inArray(resourceDislikes.resourceId, ids))
			.groupBy(resourceDislikes.resourceId)
			.all()
		const countByResource = new Map(
			countRows.map((row) => [row.resourceId, row.total]),
		)
		const since = nowFn() - RESOURCE_DISLIKE_CANCEL_WINDOW_MS
		const recentRows = client
			.select({ resourceId: resourceDislikes.resourceId })
			.from(resourceDislikes)
			.where(
				and(
					inArray(resourceDislikes.resourceId, ids),
					gt(resourceDislikes.createdAt, since),
				),
			)
			.all()
		const recently = new Set(recentRows.map((row) => row.resourceId))
		return new Map(
			ids.map((id) => [
				id,
				{
					count: countByResource.get(id) ?? 0,
					recently: recently.has(id),
				},
			]),
		)
	}

	function attachDislikeStats<T extends { readonly id: string }>(
		rows: readonly T[],
	): readonly (T & {
		readonly dislikeCount: number
		readonly dislikedRecently: boolean
	})[] {
		const stats = loadDislikeStats(rows.map((row) => row.id))
		return rows.map((row) => {
			const stat = stats.get(row.id)
			return {
				...row,
				dislikeCount: stat?.count ?? 0,
				dislikedRecently: stat?.recently ?? false,
			}
		})
	}

	function hydrate(
		bareRows: readonly Omit<
			ResRow,
			"tagIds" | "charIds" | "dislikeCount" | "dislikedRecently"
		>[],
	): readonly ResRow[] {
		return attachDislikeStats(
			attachCharacterIds(attachTagIds(bareRows)),
		) as readonly ResRow[]
	}

	function findById(id: string): ResRow {
		const core = findCoreById(id)
		const meta = client
			.select()
			.from(resourceMeta)
			.where(eq(resourceMeta.resourceId, id))
			.get()
		const [hydrated] = hydrate([mergeMeta(core, meta)])
		return hydrated as ResRow
	}

	function buildWhere(q: ResListQuery) {
		const {
			trashed,
			query,
			charIds,
			tagIds,
			colIds,
			contentPluginId,
			sourceName,
			searchMetaFacets,
			searchIntro,
			ids,
		} = q
		const noCharacters = q.noCharacters ?? false
		const dislikedOnly = q.dislikedOnly ?? false
		const tagMode = q.tagMode
		const lifecycle = trashed
			? isNotNull(resources.deletedAt)
			: isNull(resources.deletedAt)
		const clauses: Array<ReturnType<typeof and>> = [lifecycle]
		if (ids !== undefined && ids.length > 0) {
			clauses.push(inArray(resources.id, ids))
		}
		if (query !== undefined && query.length > 0) {
			// The free-text query matches the display name and the
			// user-set source name (any site/platform label). Intro stays
			// behind the `searchIntro` opt-in.
			const nameOrSource = or(
				likeContainsLower(resources.name, query),
				likeContainsLower(resources.sourceName, query),
			)
			const q =
				searchIntro === true
					? or(nameOrSource, likeContainsLower(resources.intro, query))
					: nameOrSource
			if (q !== undefined) clauses.push(q)
		}
		if (contentPluginId !== undefined) {
			clauses.push(eq(resources.contentPluginId, contentPluginId))
		}
		if (sourceName !== undefined && sourceName.length > 0) {
			clauses.push(eq(resources.sourceName, sourceName))
		}
		if (searchMetaFacets !== undefined) {
			const activeKeys = Object.entries(searchMetaFacets)
				.filter(([, v]) => v)
				.map(([k]) => k)
			if (activeKeys.length > 0) {
				const kindClauses = activeKeys.map(
					(key) =>
						sql`json_extract(${resourceMeta.searchMeta}, ${`$.facets.${key}`}) = 1`,
				)
				const combined = or(...kindClauses)
				if (combined !== undefined) {
					clauses.push(
						exists(
							client
								.select({ one: sql`1` })
								.from(resourceMeta)
								.where(
									and(eq(resourceMeta.resourceId, resources.id), combined),
								),
						),
					)
				}
			}
		}
		if (charIds !== undefined && charIds.length > 0) {
			clauses.push(
				exists(
					client
						.select({ one: sql`1` })
						.from(resCharacters)
						.where(
							and(
								eq(resCharacters.resId, resources.id),
								inArray(resCharacters.charId, charIds),
							),
						),
				),
			)
		} else if (noCharacters) {
			clauses.push(
				not(
					exists(
						client
							.select({ one: sql`1` })
							.from(resCharacters)
							.where(eq(resCharacters.resId, resources.id)),
					),
				),
			)
		}
		if (tagIds !== undefined && tagIds.length > 0) {
			clauses.push(
				...buildTagFilterClauses({
					db: client,
					entityIdColumn: resTags.resId,
					tagIdColumn: resTags.tagId,
					outerEntityIdColumn: resources.id,
					tagIds,
					tagMode,
					// A sibling group's character members match via the
					// resource↔character join.
					characterJoin: {
						entityIdColumn: resCharacters.resId,
						charIdColumn: resCharacters.charId,
						outerEntityIdColumn: resources.id,
					},
				}),
			)
		}
		if (colIds !== undefined && colIds.length > 0) {
			// Membership in any of the selected collections (OR within the
			// facet).
			clauses.push(
				exists(
					client
						.select({ one: sql`1` })
						.from(resCollectionItems)
						.where(
							and(
								eq(resCollectionItems.resId, resources.id),
								inArray(resCollectionItems.colId, colIds),
							),
						),
				),
			)
		}
		if (dislikedOnly) {
			clauses.push(
				exists(
					client
						.select({ one: sql`1` })
						.from(resourceDislikes)
						.where(eq(resourceDislikes.resourceId, resources.id)),
				),
			)
		}
		return clauses.length === 1 ? clauses[0] : and(...clauses)
	}

	function listPage(q: ResListQuery): ResRowPage {
		const where = buildWhere(q)
		const totalRow = client
			.select({ total: count() })
			.from(resources)
			.where(where)
			.get()
		const total = totalRow?.total ?? 0
		const orderClause =
			q.random === true
				? // Deterministic shuffle: the same seed always yields the same
					// order, so pagination is stable. A missing seed (older
					// clients) falls back to a fixed default rather than
					// `RANDOM()`, which would reshuffle between pages.
					// `id` breaks hash ties to keep the total order stable.
					[sql`hash(${q.seed ?? ""} || ${resources.id})`, asc(resources.id)]
				: (() => {
						const sortDir = (q.order ?? "desc") === "asc" ? asc : desc
						if (q.sortBy === "disliked") {
							return [
								sortDir(
									sql<number>`(select count(*) from resource_dislikes where resource_dislikes.resource_id = ${resources.id})`,
								),
								desc(resources.id),
							]
						}
						const sortCol =
							(q.sortBy ?? "created") === "updated"
								? resources.updatedAt
								: resources.createdAt
						return [sortDir(sortCol), desc(resources.id)]
					})()
		const coreRows = client
			.select()
			.from(resources)
			.where(where)
			.orderBy(...orderClause)
			.limit(q.size)
			.offset((q.page - 1) * q.size)
			.all()
		const metaById = loadMetaByIds(coreRows.map((row) => row.id))
		const bareRows = coreRows.map((core) =>
			mergeMeta(core, metaById.get(core.id)),
		)
		return { rows: hydrate(bareRows), total }
	}

	/**
	 * Returns the same page as {@link listPage} but each row is enriched with
	 * pre-computed `pinnedTags` and `characters`. Both are fetched in single
	 * batch queries - O(page_size + tags_on_page + chars_on_page), not O(N).
	 */
	function listCardPage(q: ResListQuery): ResCardRowPage {
		const { rows, total } = listPage(q)
		return { rows: attachCardData(rows), total }
	}

	/**
	 * Batch-enrich bare rows with `pinnedTags`, `characters` and
	 * `collections` (three queries, zero N+1). Shared by {@link listCardPage}
	 * and {@link memories}.
	 */
	function attachCardData(rows: readonly ResRow[]): readonly ResCardRow[] {
		if (rows.length === 0) return []
		const ids = rows.map((r) => r.id)

		const pinnedRows = client
			.select({
				resId: resTags.resId,
				tagId: tags.id,
				tagName: tags.name,
				tagColor: sql<string>`COALESCE(NULLIF(${tags.color}, ''), NULLIF(${categories.color}, ''), '')`,
			})
			.from(resTags)
			.innerJoin(tags, eq(resTags.tagId, tags.id))
			.leftJoin(categories, eq(tags.catId, categories.id))
			.where(
				and(
					inArray(resTags.resId, ids),
					or(eq(tags.pinned, true), eq(categories.pinned, true)),
				),
			)
			.orderBy(sql`COALESCE(${categories.position}, 2147483647)`, tags.position)
			.all()

		const pinnedByResource = new Map<
			string,
			Array<{ id: string; name: string; color: string; virtual?: boolean }>
		>()
		const pairs = loadSiblingPairs(client)
		for (const r of pinnedRows) {
			let list = pinnedByResource.get(r.resId)
			if (list === undefined) {
				list = []
				pinnedByResource.set(r.resId, list)
			}
			list.push({ id: r.tagId, name: r.tagName, color: r.tagColor })
		}
		// Sibling groups render as their display tag (collapse), then the
		// entity's virtual (rule-carried) pinned tags are appended.
		const tagRows = client
			.select({ resId: resTags.resId, tagId: resTags.tagId })
			.from(resTags)
			.where(inArray(resTags.resId, ids))
			.all()
		const tagIdsByResource = new Map<string, string[]>()
		for (const r of tagRows) {
			let list = tagIdsByResource.get(r.resId)
			if (list === undefined) {
				list = []
				tagIdsByResource.set(r.resId, list)
			}
			list.push(r.tagId)
		}

		const charRows = client
			.select({
				resId: resCharacters.resId,
				charId: characters.id,
				charName: characters.name,
				charUpdatedAt: characters.updatedAt,
			})
			.from(resCharacters)
			.innerJoin(characters, eq(resCharacters.charId, characters.id))
			.where(inArray(resCharacters.resId, ids))
			.all()

		const charsByResource = new Map<
			string,
			Array<{ id: string; name: string; updatedAt: number }>
		>()
		for (const r of charRows) {
			let list = charsByResource.get(r.resId)
			if (list === undefined) {
				list = []
				charsByResource.set(r.resId, list)
			}
			list.push({ id: r.charId, name: r.charName, updatedAt: r.charUpdatedAt })
		}

		for (const resId of ids) {
			const collapsed = collapsePinnedTags(
				client,
				pinnedByResource.get(resId) ?? [],
				pairs,
			)
			pinnedByResource.set(resId, [
				...withPinnedVirtualTags(client, collapsed, {
					tagIds: tagIdsByResource.get(resId) ?? [],
					characterIds: (charsByResource.get(resId) ?? []).map((c) => c.id),
				}),
			])
		}

		const colRows = client
			.select({
				resId: resCollectionItems.resId,
				colId: resCollections.id,
				name: resCollections.name,
				color: resCollections.color,
			})
			.from(resCollectionItems)
			.innerJoin(
				resCollections,
				eq(resCollectionItems.colId, resCollections.id),
			)
			.where(inArray(resCollectionItems.resId, ids))
			.orderBy(
				desc(resCollections.pinned),
				asc(resCollections.position),
				asc(resCollections.name),
			)
			.all()
		const colsByResource = new Map<
			string,
			Array<{ id: string; name: string; color: string }>
		>()
		for (const r of colRows) {
			let list = colsByResource.get(r.resId)
			if (list === undefined) {
				list = []
				colsByResource.set(r.resId, list)
			}
			list.push({ id: r.colId, name: r.name, color: r.color })
		}

		const cardRows: readonly ResCardRow[] = rows.map((row) => ({
			...row,
			pinnedTags: pinnedByResource.get(row.id) ?? [],
			characters: charsByResource.get(row.id) ?? [],
			collections: colsByResource.get(row.id) ?? [],
		}))
		return cardRows
	}

	/**
	 * Live resources created on `month`-`day` (in the user's offset) of any
	 * year before the current one. Uses `strftime` with a fixed-offset
	 * modifier so `createdAt` (unix ms) is interpreted in the user's
	 * calendar day; DST boundary drift around midnight is accepted.
	 * Personal-archive scale makes the scan negligible, so no extra index.
	 */
	function memories(q: ResMemoriesQuery): readonly ResCardRow[] {
		const offset = `${q.offsetMin >= 0 ? "+" : ""}${q.offsetMin} minutes`
		const mmdd = `${String(q.month).padStart(2, "0")}-${String(q.day).padStart(2, "0")}`
		// Year of "now" in the user's offset: DST-aware via the JS date math
		// instead of a second strftime call. Compared as TEXT — a bare
		// integer operand would never equal strftime's text output under
		// SQLite's storage-class ordering.
		const nowOffsetMs = q.offsetMin * 60_000
		const currentYear = String(
			new Date(Date.now() + nowOffsetMs).getUTCFullYear(),
		)
		const coreRows = client
			.select()
			.from(resources)
			.where(
				and(
					isNull(resources.deletedAt),
					sql`strftime('%m-%d', ${resources.createdAt} / 1000, 'unixepoch', ${offset}) = ${mmdd}`,
					sql`strftime('%Y', ${resources.createdAt} / 1000, 'unixepoch', ${offset}) != ${currentYear}`,
				),
			)
			.orderBy(desc(resources.createdAt))
			.limit(q.limit)
			.all()
		if (coreRows.length === 0) return []
		const metaById = loadMetaByIds(coreRows.map((row) => row.id))
		const bareRows = coreRows.map((core) =>
			mergeMeta(core, metaById.get(core.id)),
		)
		return attachCardData(hydrate(bareRows))
	}

	function listSourceNames(limit: number): readonly SourceNameCount[] {
		const rows = client
			.select({
				name: resources.sourceName,
				count: count(),
			})
			.from(resources)
			.where(
				and(
					isNull(resources.deletedAt),
					isNotNull(resources.sourceName),
					ne(resources.sourceName, ""),
				),
			)
			.groupBy(resources.sourceName)
			.orderBy(desc(count()), asc(resources.sourceName))
			.limit(limit)
			.all()
		return rows.flatMap((row) =>
			row.name === null ? [] : [{ name: row.name, count: row.count }],
		)
	}

	function findCardById(id: string): ResCardRow {
		const base = findById(id)
		const pinnedTags = client
			.select({
				id: tags.id,
				name: tags.name,
				color: sql<string>`COALESCE(NULLIF(${tags.color}, ''), NULLIF(${categories.color}, ''), '')`,
			})
			.from(resTags)
			.innerJoin(tags, eq(resTags.tagId, tags.id))
			.leftJoin(categories, eq(tags.catId, categories.id))
			.where(
				and(
					eq(resTags.resId, id),
					or(eq(tags.pinned, true), eq(categories.pinned, true)),
				),
			)
			.orderBy(sql`COALESCE(${categories.position}, 2147483647)`, tags.position)
			.all()
		const charRows = client
			.select({
				id: characters.id,
				name: characters.name,
				updatedAt: characters.updatedAt,
			})
			.from(resCharacters)
			.innerJoin(characters, eq(resCharacters.charId, characters.id))
			.where(eq(resCharacters.resId, id))
			.all()
		const colsList = client
			.select({
				id: resCollections.id,
				name: resCollections.name,
				color: resCollections.color,
			})
			.from(resCollectionItems)
			.innerJoin(
				resCollections,
				eq(resCollectionItems.colId, resCollections.id),
			)
			.where(eq(resCollectionItems.resId, id))
			.orderBy(
				desc(resCollections.pinned),
				asc(resCollections.position),
				asc(resCollections.name),
			)
			.all()
		const attachedTagIds = client
			.select({ tagId: resTags.tagId })
			.from(resTags)
			.where(eq(resTags.resId, id))
			.all()
			.map((r) => r.tagId)
		return {
			...base,
			pinnedTags: withPinnedVirtualTags(
				client,
				collapsePinnedTags(client, pinnedTags),
				{
					tagIds: attachedTagIds,
					characterIds: charRows.map((c) => c.id),
				},
			),
			characters: charRows,
			collections: colsList,
		}
	}

	function insert(
		id: string,
		values: ResDbValues,
		ts: number,
		fileVersion: number,
	): void {
		client.transaction((tx) => {
			tx.insert(resources)
				.values({
					id,
					name: values.name,
					intro: values.intro,
					sourceName: values.sourceName ?? null,
					sourceUrl: values.sourceUrl ?? null,
					contentPluginId: values.contentPluginId,
					fileVersion,
					coverVersion: fileVersion,
					createdAt: ts,
					updatedAt: ts,
				})
				.run()
			for (const tagId of values.tagIds) {
				tx.insert(resTags).values({ resId: id, tagId }).run()
			}
			for (const charId of values.charIds) {
				tx.insert(resCharacters).values({ resId: id, charId }).run()
			}
		})
	}

	function patch(id: string, fields: ResDbPatch, joins?: ResJoinPatch): void {
		client.transaction((tx) => {
			if (Object.keys(fields).length > 0) {
				tx.update(resources).set(fields).where(eq(resources.id, id)).run()
			}
			if (joins?.tagIds !== undefined) {
				tx.delete(resTags).where(eq(resTags.resId, id)).run()
				for (const tagId of joins.tagIds) {
					tx.insert(resTags).values({ resId: id, tagId }).run()
				}
			}
			if (joins?.charIds !== undefined) {
				tx.delete(resCharacters).where(eq(resCharacters.resId, id)).run()
				for (const charId of joins.charIds) {
					tx.insert(resCharacters).values({ resId: id, charId }).run()
				}
			}
		})
	}

	function patchMeta(id: string, fields: ResMetaPatch, builtAt: number): void {
		findCoreById(id)
		const existing = client
			.select()
			.from(resourceMeta)
			.where(eq(resourceMeta.resourceId, id))
			.get()
		if (existing === undefined) {
			client
				.insert(resourceMeta)
				.values({
					resourceId: id,
					coverMeta: fields.coverMeta ?? null,
					sourceMeta: fields.sourceMeta ?? null,
					searchMeta: fields.searchMeta ?? null,
					fileStats: fields.fileStats ?? null,
					hashesMeta: fields.hashesMeta ?? null,
					builtAt,
				})
				.run()
			return
		}
		const next = {
			...(fields.coverMeta !== undefined
				? { coverMeta: fields.coverMeta }
				: {}),
			...(fields.sourceMeta !== undefined
				? { sourceMeta: fields.sourceMeta }
				: {}),
			...(fields.searchMeta !== undefined
				? { searchMeta: fields.searchMeta }
				: {}),
			...(fields.fileStats !== undefined
				? { fileStats: fields.fileStats }
				: {}),
			...(fields.hashesMeta !== undefined
				? { hashesMeta: fields.hashesMeta }
				: {}),
			builtAt,
		}
		if (Object.keys(next).length === 1) return
		client
			.update(resourceMeta)
			.set(next)
			.where(eq(resourceMeta.resourceId, id))
			.run()
	}

	function clearAllMeta(): void {
		const ts = Date.now()
		client
			.update(resourceMeta)
			.set({
				// fileStats is plugin-independent and stable — never wiped
				// here; rebuilds recompute it (see meta-ops computeFileStats).
				sourceMeta: null,
				searchMeta: null,
				coverMeta: null,
				hashesMeta: null,
				builtAt: ts,
			})
			.run()
	}

	/** Live resources currently bound to the given content plugin. */
	function countByContentPluginId(pluginId: string): number {
		const row = client
			.select({ total: count() })
			.from(resources)
			.where(eq(resources.contentPluginId, pluginId))
			.get()
		return row?.total ?? 0
	}

	function replaceHashes(
		resourceId: string,
		pluginId: string,
		entries: readonly HashEntry[],
	): void {
		client.transaction((tx) => {
			tx.delete(resourceHashes)
				.where(eq(resourceHashes.resourceId, resourceId))
				.run()
			if (entries.length === 0) return
			tx.insert(resourceHashes)
				.values(
					entries.map((entry) => ({
						resourceId,
						pluginId,
						scope: entry.scope,
						type: entry.type,
						value: entry.value,
						bits: entry.bits,
					})),
				)
				.run()
		})
	}

	function listHashes(resourceId: string): readonly ResourceHashRow[] {
		return client
			.select()
			.from(resourceHashes)
			.where(eq(resourceHashes.resourceId, resourceId))
			.all()
	}

	function listHashesOfType(
		type: string,
		excludeResourceId?: string,
	): readonly ResourceHashRow[] {
		return client
			.select()
			.from(resourceHashes)
			.where(
				and(
					eq(resourceHashes.type, type),
					excludeResourceId !== undefined
						? ne(resourceHashes.resourceId, excludeResourceId)
						: undefined,
					inArray(
						resourceHashes.resourceId,
						client
							.select({ id: resources.id })
							.from(resources)
							.where(isNull(resources.deletedAt)),
					),
				),
			)
			.all()
	}

	function findExactHashMatches(
		type: string,
		value: string,
		excludeResourceId: string,
	): readonly ResourceHashRow[] {
		return client
			.select()
			.from(resourceHashes)
			.where(
				and(
					eq(resourceHashes.type, type),
					eq(resourceHashes.value, value),
					ne(resourceHashes.resourceId, excludeResourceId),
					inArray(
						resourceHashes.resourceId,
						client
							.select({ id: resources.id })
							.from(resources)
							.where(isNull(resources.deletedAt)),
					),
				),
			)
			.all()
	}

	function insertDislike(id: string, resourceId: string, ts: number): void {
		client
			.insert(resourceDislikes)
			.values({ id, resourceId, createdAt: ts })
			.run()
	}

	function deleteDislike(id: string): void {
		client.delete(resourceDislikes).where(eq(resourceDislikes.id, id)).run()
	}

	function findLatestDislike(
		resourceId: string,
	): ResourceDislikeRow | undefined {
		return (
			client
				.select()
				.from(resourceDislikes)
				.where(eq(resourceDislikes.resourceId, resourceId))
				.orderBy(desc(resourceDislikes.createdAt))
				.limit(1)
				.get() ?? undefined
		)
	}

	function listDislikes(resourceId: string): readonly ResourceDislikeRow[] {
		return client
			.select()
			.from(resourceDislikes)
			.where(eq(resourceDislikes.resourceId, resourceId))
			.orderBy(desc(resourceDislikes.createdAt))
			.all()
	}

	return {
		findById,
		findCardById,
		listPage,
		listCardPage,
		memories,
		listSourceNames,
		insert,
		patch,
		patchMeta,
		remove,
		clearAllMeta,
		countByContentPluginId,
		replaceHashes,
		listHashes,
		listHashesOfType,
		findExactHashMatches,
		insertDislike,
		deleteDislike,
		findLatestDislike,
		listDislikes,
	}
}

export function rowToResource(row: ResRow): Resource {
	const base: Resource = {
		id: row.id,
		name: row.name,
		intro: row.intro,
		contentPluginId: row.contentPluginId,
		tagIds: [...row.tagIds],
		charIds: [...row.charIds],
		coverVersion: row.coverVersion,
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
		dislikeCount: row.dislikeCount,
		dislikedRecently: row.dislikedRecently,
	}
	const coverMetaPart = parseCoverMetaFast(row.coverMeta)
	const fileStatsPart = parseFileStatsFast(row.fileStats)
	const sourceMetaPart = parseSourceMetaFast(row.sourceMeta)
	const searchMetaPart = parseSearchMetaFast(row.searchMeta)
	return produce(base, (draft) => {
		if (row.sourceName !== null) draft.sourceName = row.sourceName
		if (row.sourceUrl !== null) draft.sourceUrl = row.sourceUrl
		if (coverMetaPart !== undefined) draft.coverMeta = coverMetaPart
		if (fileStatsPart !== undefined) draft.fileStats = fileStatsPart
		if (sourceMetaPart !== undefined) draft.sourceMeta = sourceMetaPart
		if (searchMetaPart !== undefined) draft.searchMeta = searchMetaPart
		if (row.deletedAt !== null) draft.deletedAt = row.deletedAt
	})
}

export function rowToResourceCard(row: ResCardRow): ResCard {
	return {
		...rowToResource(row),
		pinnedTags: [...row.pinnedTags],
		characters: [...row.characters],
		collections: [...row.collections],
	}
}

export function parseCoverMeta(raw: string | null): CoverMeta | undefined {
	return parseJsonColumn(raw, coverMetaSchema.safeParse.bind(coverMetaSchema))
}

export function parseFileStats(raw: string | null): FileStats | undefined {
	return parseJsonColumn(raw, fileStatsSchema.safeParse.bind(fileStatsSchema))
}

export function parseSourceMeta(
	raw: string | null,
): SourceMetaBase | undefined {
	return parseJsonColumn(raw, sourceMetaBase.safeParse.bind(sourceMetaBase))
}

export function parseSearchMeta(raw: string | null): SearchMeta | undefined {
	return parseJsonColumn(raw, searchMetaSchema.safeParse.bind(searchMetaSchema))
}

export function parseHashesMeta(raw: string | null): HashesMeta | undefined {
	return parseJsonColumn(raw, hashesMetaSchema.safeParse.bind(hashesMetaSchema))
}

// ── Fast row-mapping parsers ──────────────────────────────────────────────
//
// `rowToResource` runs four parses per row on every list/detail response,
// and the Zod `safeParse` path costs more than the surrounding page query
// (measured ~4ms vs ~4ms per 200 rows in bench/micro/db.bench.ts). The
// DB is the write boundary: `applyMetaPatch` (meta-ops.ts) already
// validates every column with the strict Zod parsers above before it is
// stored, so the read path only needs structural guards against corrupt
// or legacy rows. A parse failure yields `undefined`, exactly like the
// Zod parsers.

function isObject(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isPositiveInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value > 0
}

function isNonnegativeInt(value: unknown): value is number {
	return typeof value === "number" && Number.isInteger(value) && value >= 0
}

function isCoverKind(value: unknown): value is CoverKind {
	return typeof value === "string" && COVER_KINDS.some((kind) => kind === value)
}

function parseCoverMetaFast(raw: string | null): CoverMeta | undefined {
	if (raw === null) return undefined
	try {
		const value: unknown = JSON.parse(raw)
		if (!isObject(value)) return undefined
		if (isEmptyMeta(value)) return { empty: true }
		if (!isCoverKind(value.kind)) return undefined
		const width = value.width
		const height = value.height
		const source = value.source
		return {
			...(isPositiveInt(width) ? { width } : {}),
			...(isPositiveInt(height) ? { height } : {}),
			kind: value.kind,
			...(typeof source === "string" ? { source } : {}),
		}
	} catch {
		return undefined
	}
}

function parseFileStatsFast(raw: string | null): FileStats | undefined {
	if (raw === null) return undefined
	try {
		const value: unknown = JSON.parse(raw)
		if (!isObject(value)) return undefined
		const sizeBytes = value.sizeBytes
		const count = value.count
		return {
			...(isNonnegativeInt(sizeBytes) ? { sizeBytes } : {}),
			...(isNonnegativeInt(count) ? { count } : {}),
		}
	} catch {
		return undefined
	}
}

function parseSourceMetaFast(raw: string | null): SourceMetaBase | undefined {
	if (raw === null) return undefined
	try {
		const value: unknown = JSON.parse(raw)
		// The sourceMeta schema is passthrough: any non-array object.
		return isObject(value) ? (value as SourceMetaBase) : undefined
	} catch {
		return undefined
	}
}

function parseSearchMetaFast(raw: string | null): SearchMeta | undefined {
	if (raw === null) return undefined
	try {
		const value: unknown = JSON.parse(raw)
		if (!isObject(value)) return undefined
		const v = value.v
		if (!isPositiveInt(v)) return undefined
		const facets = value.facets
		if (facets === undefined) return { v }
		if (!isObject(facets)) return undefined
		for (const flag of Object.values(facets)) {
			if (typeof flag !== "boolean") return undefined
		}
		return { v, facets: facets as Record<string, boolean> }
	} catch {
		return undefined
	}
}

type SafeParse<T> = (
	input: unknown,
) => { readonly success: true; readonly data: T } | { readonly success: false }

function parseJsonColumn<T>(
	raw: string | null,
	safeParse: SafeParse<T>,
): T | undefined {
	if (raw === null) return undefined
	try {
		const parsed: unknown = JSON.parse(raw)
		const result = safeParse(parsed)
		return result.success ? result.data : undefined
	} catch {
		return undefined
	}
}

/**
 * Which of the given resource ids still exist and are not soft-deleted.
 * Preserves the input order. Shared by domains that aggregate over
 * resources (usage stats, docs).
 */
export function filterExistingResourceIds(
	client: DbClient,
	ids: readonly string[],
): readonly string[] {
	if (ids.length === 0) return []
	const rows = client
		.select({ id: resources.id })
		.from(resources)
		.where(and(inArray(resources.id, ids), isNull(resources.deletedAt)))
		.all()
	const existing = new Set(rows.map((row) => row.id))
	return ids.filter((id) => existing.has(id))
}
