import { and, eq, inArray, type SQL, sql } from "drizzle-orm"
import type { AnySQLiteColumn } from "drizzle-orm/sqlite-core"
import { characters } from "src/domain/char/schema.ts"
import { systemPreferences } from "src/domain/prefs/schema.ts"
import { resCharacters, resources } from "src/domain/res/schema.ts"
import type { DbClient } from "src/infra/db/connection.ts"
import { loadSiblingPairs } from "./collapse.ts"
import { buildTagFilterClauses } from "./filter.ts"
import { siblingDisplayOf } from "./rules.ts"
import { charTags, resTags, tags } from "./schema.ts"

/** System-preference key for the global watch-only toggle. */
export const WATCH_ONLY_PREF_KEY = "tags.watchOnlyEnabled"

/** The tags a visibility-related query must consider, keyed by mode. */
export type TagVisibilitySets = {
	readonly watchTagIds: readonly string[]
	readonly explicitTagIds: readonly string[]
}

/** Inputs to {@link buildVisibilityClauses} (mirrors {@link TagFilterInputs}). */
export type VisibilityClauseInputs = {
	readonly db: DbClient
	readonly entityIdColumn: AnySQLiteColumn
	readonly tagIdColumn: AnySQLiteColumn
	readonly outerEntityIdColumn: AnySQLiteColumn
	/** EXISTS over an entity→character join table (resource lists). */
	readonly characterJoin?: {
		readonly entityIdColumn: AnySQLiteColumn
		readonly charIdColumn: AnySQLiteColumn
		readonly outerEntityIdColumn: AnySQLiteColumn
	}
	/** Self-membership column (character lists: the entity IS the member). */
	readonly selfCharacterIdColumn?: AnySQLiteColumn
	/**
	 * The tags the user has explicitly selected to view (the active filter).
	 * Only report tags whose sibling-group display is selected reveal their
	 * content; a carried explicit-view tag that is not selected hides the
	 * entity wholly (conservative "any-unselected-hides" reading).
	 */
	readonly selectedTagIds?: readonly string[]
}

/**
 * Read the global watch-only toggle (system preference). Absent key means
 * off. The server is the single authority here — repos consult it directly
 * so every content list query honours the toggle without threading a flag
 * through services.
 */
export function readWatchOnlyEnabled(client: DbClient): boolean {
	const row = client
		.select({ value: systemPreferences.value })
		.from(systemPreferences)
		.where(eq(systemPreferences.key, WATCH_ONLY_PREF_KEY))
		.get()
	return row !== undefined && row.value === "1"
}

/**
 * Load every tag carrying a non-default visibility, split by mode. The
 * values are raw tag ids (callers expand through sibling groups when
 * matching).
 */
export function loadTagVisibilitySets(client: DbClient): TagVisibilitySets {
	const rows = client
		.select({ id: tags.id, visibility: tags.visibility })
		.from(tags)
		.where(sql`${tags.visibility} != 'normal'`)
		.all()
	const watch: string[] = []
	const explicit: string[] = []
	for (const row of rows) {
		if (row.visibility === "watch_only") watch.push(row.id)
		else if (row.visibility === "explicit_view") explicit.push(row.id)
	}
	return { watchTagIds: watch, explicitTagIds: explicit }
}

/**
 * The WHERE fragments that implement the per-tag visibility policy for an
 * entity list query. Returned empty when nothing restricts the query so
 * callers can spread into their `clauses` accumulator directly.
 *
 * Two rules compose with AND:
 *
 * 1. **Watch-only narrowing** (only while the global toggle is on): the
 *    entity must carry at least one watch-only tag (union across tags).
 * 2. **Explicit-view hide** (always): an entity that carries an
 *    explicit-view tag whose sibling-group display is NOT among the
 *    currently selected tags is hidden.
 *
 * Both reuse the sibling/parent/character expansion of
 * `buildTagFilterClauses`, so "carry" means exactly what it means on the
 * filter rail.
 */
export function buildVisibilityClauses(inputs: VisibilityClauseInputs): SQL[] {
	const sets = loadTagVisibilitySets(inputs.db)
	if (!readWatchOnlyEnabled(inputs.db) && sets.explicitTagIds.length === 0) {
		return []
	}

	const clauses: SQL[] = []
	if (readWatchOnlyEnabled(inputs.db) && sets.watchTagIds.length > 0) {
		clauses.push(
			...buildTagFilterClauses({
				db: inputs.db,
				entityIdColumn: inputs.entityIdColumn,
				tagIdColumn: inputs.tagIdColumn,
				outerEntityIdColumn: inputs.outerEntityIdColumn,
				characterJoin: inputs.characterJoin,
				selfCharacterIdColumn: inputs.selfCharacterIdColumn,
				tagIds: sets.watchTagIds,
				tagMode: "or",
			}),
		)
	}

	if (sets.explicitTagIds.length > 0) {
		const selected = selectedDisplaySet(inputs.db, inputs.selectedTagIds)
		const unselected = sets.explicitTagIds.filter(
			(id) => !selected.has(displayOf(inputs.db, id)),
		)
		if (unselected.length > 0) {
			// `tagMode: "not"` = NOT EXISTS(any of these) — entity carries
			// none of the unselected explicit-view groups.
			clauses.push(
				...buildTagFilterClauses({
					db: inputs.db,
					entityIdColumn: inputs.entityIdColumn,
					tagIdColumn: inputs.tagIdColumn,
					outerEntityIdColumn: inputs.outerEntityIdColumn,
					characterJoin: inputs.characterJoin,
					selfCharacterIdColumn: inputs.selfCharacterIdColumn,
					tagIds: unselected,
					tagMode: "not",
				}),
			)
		}
	}

	return clauses
}

/** The sibling-group display tag of a tag (itself when ungrouped). */
function displayOf(client: DbClient, id: string): string {
	const pairs = loadSiblingPairs(client)
	if (pairs.length === 0) return id
	return siblingDisplayOf(pairs, id) ?? id
}

/**
 * The display tags of every selected tag, so an explicit-view tag counts
 * as selected when any sibling-group member of the same display is chosen.
 */
function selectedDisplaySet(
	client: DbClient,
	selectedTagIds: readonly string[] = [],
): ReadonlySet<string> {
	const set = new Set<string>()
	for (const id of selectedTagIds) set.add(displayOf(client, id))
	return set
}

const RESOURCE_INPUTS = {
	entityIdColumn: resTags.resId,
	tagIdColumn: resTags.tagId,
	outerEntityIdColumn: resources.id,
	characterJoin: {
		entityIdColumn: resCharacters.resId,
		charIdColumn: resCharacters.charId,
		outerEntityIdColumn: resources.id,
	},
} as const

const CHARACTER_INPUTS = {
	entityIdColumn: charTags.charId,
	tagIdColumn: charTags.tagId,
	outerEntityIdColumn: characters.id,
	selfCharacterIdColumn: characters.id,
} as const

/**
 * The entity ids (resources or characters) that pass the visibility
 * predicate for the given kind. Used by the facet/count scoping when
 * watch-only is on, so the tag picker and usage counts only reflect
 * content the user can actually see. Returns `undefined` when no
 * visibility restriction applies (fast path — "everything visible") so
 * callers can skip the narrowing wholesale.
 */
export function visibleEntityIds(
	client: DbClient,
	kind: "resource" | "character",
	selectedTagIds: readonly string[] = [],
): readonly string[] | undefined {
	const clauses = buildVisibilityClauses({
		db: client,
		...(kind === "resource" ? RESOURCE_INPUTS : CHARACTER_INPUTS),
		selectedTagIds,
	})
	if (clauses.length === 0) return undefined
	const table = kind === "resource" ? resources : characters
	return client
		.select({ id: table.id })
		.from(table)
		.where(and(...clauses))
		.all()
		.map((r) => r.id)
}

/**
 * Every tag id appearing on a resource or character in the given id sets.
 * Resolves the visible tag universe for the watch-only facet narrowing and
 * count scoping in one pass.
 */
export function visibleTagUniverse(
	client: DbClient,
	resIds: readonly string[],
	charIds: readonly string[],
): ReadonlySet<string> {
	const tagIds = new Set<string>()
	if (resIds.length > 0) {
		for (const r of client
			.select({ tagId: resTags.tagId })
			.from(resTags)
			.where(inArray(resTags.resId, resIds))
			.all()) {
			tagIds.add(r.tagId)
		}
	}
	if (charIds.length > 0) {
		for (const r of client
			.select({ tagId: charTags.tagId })
			.from(charTags)
			.where(inArray(charTags.charId, charIds))
			.all()) {
			tagIds.add(r.tagId)
		}
	}
	return tagIds
}
