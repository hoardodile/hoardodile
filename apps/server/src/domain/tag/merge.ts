import { conflict } from "@hoardodile/shared"
import { and, count, eq, inArray, or } from "drizzle-orm"
import { categories } from "src/domain/cat/schema.ts"
import { characters } from "src/domain/char/schema.ts"
import { resources } from "src/domain/res/schema.ts"
import type { DbClient } from "src/infra/db/connection.ts"
import { buildTagRepository, type TagRow } from "./repo.ts"
import {
	migrateParentRulesForMerge,
	migrateSiblingPairsForMerge,
	type ParentRule,
	type SiblingPair,
} from "./rules.ts"
import { charTags, parentRules, resTags, siblingPairs, tags } from "./schema.ts"

/**
 * Merge is the first-class operation that eliminates duplicate tags:
 * every resource/character usage and every rule of the source tag is
 * moved onto the target, then the source is deleted. Merge is shared by
 * the tRPC surface (preview + confirmed merge) and the first-run dedupe
 * script, which is "merge applied at startup".
 *
 * Callers own the transaction: `applyTagMerge` takes a {@link DbClient}
 * and must be wrapped in `withTransaction` (by the service, or by the
 * dedupe's outer transaction) so a blocked merge never leaves a partial
 * state.
 */

export type TagMergePreview = {
	readonly sourceId: string
	readonly targetId: string
	readonly resourceCount: number
	readonly characterCount: number
	readonly siblingRuleCount: number
	readonly parentRuleCount: number
}

export type TagMergeResult = {
	readonly targetId: string
	readonly movedResources: number
	readonly movedCharacters: number
	readonly movedSiblingRules: number
	readonly movedParentRules: number
}

/**
 * Validate that a `source → target` merge is even possible: both tags
 * exist, they differ, and their namespaces share a kind (tags never carry
 * a kind themselves — it comes from their namespace). Cross-kind merges
 * are rejected per the PRD; the namespace check is the whole story.
 */
function assertMergeable(
	client: DbClient,
	sourceId: string,
	targetId: string,
): { readonly source: TagRow; readonly target: TagRow } {
	if (sourceId === targetId) {
		throw conflict("tag.merge.same_tag", "cannot merge a tag into itself", {
			id: sourceId,
		})
	}
	const repo = buildTagRepository(client)
	const source = repo.findById(sourceId)
	const target = repo.findById(targetId)
	const sourceKind = namespaceKindOf(client, source.catId, sourceId)
	const targetKind = namespaceKindOf(client, target.catId, targetId)
	if (sourceKind !== targetKind) {
		throw conflict(
			"tag.merge.kind_mismatch",
			`cannot merge tags across kinds (${sourceKind} vs ${targetKind})`,
			{ sourceId, targetId, sourceKind, targetKind },
		)
	}
	return { source, target }
}

function namespaceKindOf(
	client: DbClient,
	catId: string | null,
	tagId: string,
): string {
	if (catId === null) {
		throw conflict(
			"tag.merge.orphan",
			"tag has no namespace; move it into a namespace first",
			{ tagId },
		)
	}
	const cat = client
		.select({ kind: categories.kind })
		.from(categories)
		.where(eq(categories.id, catId))
		.get()
	if (cat === undefined) {
		throw conflict(
			"tag.merge.namespace_missing",
			"tag's namespace no longer exists",
			{ tagId, catId },
		)
	}
	return cat.kind
}

/**
 * Non-mutating preview of a merge: the number of resource/character
 * usages and rules that would move. Rejects impossible merges (missing
 * tags, self-merge, cross-kind) exactly like the apply step so the UI can
 * surface the same errors before confirmation.
 */
export function previewTagMerge(
	client: DbClient,
	sourceId: string,
	targetId: string,
): TagMergePreview {
	assertMergeable(client, sourceId, targetId)
	const repo = buildTagRepository(client)
	const siblingCount = client
		.select({ value: count() })
		.from(siblingPairs)
		.where(
			or(
				and(eq(siblingPairs.badKind, "tag"), eq(siblingPairs.badId, sourceId)),
				eq(siblingPairs.goodId, sourceId),
			),
		)
		.get()
	const parentCount = client
		.select({ value: count() })
		.from(parentRules)
		.where(
			or(
				and(
					eq(parentRules.childKind, "tag"),
					eq(parentRules.childId, sourceId),
				),
				eq(parentRules.parentId, sourceId),
			),
		)
		.get()
	return {
		sourceId,
		targetId,
		resourceCount: repo.countResourceUsages(sourceId),
		characterCount: repo.countCharacterUsages(sourceId),
		siblingRuleCount: siblingCount?.value ?? 0,
		parentRuleCount: parentCount?.value ?? 0,
	}
}

/**
 * Move a source tag's usages onto the target inside `tx`: copy the join
 * rows (conflicts are ignored — the target may already be attached),
 * delete the source's rows, and touch the affected entities' `updatedAt`
 * so merge behaves like any other attach operation.
 */
function moveResourceUsages(
	tx: DbClient,
	sourceId: string,
	targetId: string,
	now: () => number,
): number {
	const rows = tx
		.select({ resId: resTags.resId })
		.from(resTags)
		.where(eq(resTags.tagId, sourceId))
		.all()
	if (rows.length === 0) return 0
	tx.insert(resTags)
		.values(rows.map((r) => ({ resId: r.resId, tagId: targetId })))
		.onConflictDoNothing()
		.run()
	tx.delete(resTags).where(eq(resTags.tagId, sourceId)).run()
	tx.update(resources)
		.set({ updatedAt: now() })
		.where(
			inArray(
				resources.id,
				rows.map((r) => r.resId),
			),
		)
		.run()
	return rows.length
}

function moveCharacterUsages(
	tx: DbClient,
	sourceId: string,
	targetId: string,
	now: () => number,
): number {
	const rows = tx
		.select({ charId: charTags.charId })
		.from(charTags)
		.where(eq(charTags.tagId, sourceId))
		.all()
	if (rows.length === 0) return 0
	tx.insert(charTags)
		.values(rows.map((r) => ({ charId: r.charId, tagId: targetId })))
		.onConflictDoNothing()
		.run()
	tx.delete(charTags).where(eq(charTags.tagId, sourceId)).run()
	tx.update(characters)
		.set({ updatedAt: now() })
		.where(
			inArray(
				characters.id,
				rows.map((r) => r.charId),
			),
		)
		.run()
	return rows.length
}

/**
 * Migrate the sibling pairs for a merge (group-union semantics — see
 * `rules.ts`). The rule tables are tiny, so the whole set is rewritten
 * inside the caller's transaction; untouched pairs get a fresh
 * `createdAt`, which is harmless because rules are not time-sensitive.
 */
function migrateSiblingRules(
	tx: DbClient,
	sourceId: string,
	targetId: string,
	now: () => number,
): number {
	const pairs: readonly SiblingPair[] = tx
		.select({
			badKind: siblingPairs.badKind,
			badId: siblingPairs.badId,
			badCharacterId: siblingPairs.badCharacterId,
			goodId: siblingPairs.goodId,
		})
		.from(siblingPairs)
		.all()
		.map((r) => ({
			badKind: r.badKind,
			badId: r.badId ?? r.badCharacterId!,
			goodId: r.goodId,
		}))
	const migrated = migrateSiblingPairsForMerge(pairs, sourceId, targetId)
	const ts = now()
	tx.delete(siblingPairs).run()
	if (migrated.pairs.length > 0) {
		tx.insert(siblingPairs)
			.values(
				migrated.pairs.map((p) => ({
					badKind: p.badKind,
					badId: p.badKind === "tag" ? p.badId : null,
					badCharacterId: p.badKind === "character" ? p.badId : null,
					goodId: p.goodId,
					createdAt: ts,
				})),
			)
			.run()
	}
	return migrated.movedCount
}

/**
 * Migrate the parent rules for a merge: repoint source-involving rules at
 * the target, collapse duplicates, then re-check for cycles — a merge
 * that would create a cycle is blocked (the PRD's "untangle related rules first" case).
 */
function migrateParentRules(
	tx: DbClient,
	sourceId: string,
	targetId: string,
	now: () => number,
): number {
	const rules: readonly ParentRule[] = tx
		.select({
			childKind: parentRules.childKind,
			childId: parentRules.childId,
			childCharacterId: parentRules.childCharacterId,
			parentId: parentRules.parentId,
		})
		.from(parentRules)
		.all()
		.map((r) => ({
			childKind: r.childKind,
			childId: r.childId ?? r.childCharacterId!,
			parentId: r.parentId,
		}))
	const migrated = migrateParentRulesForMerge(rules, sourceId, targetId)
	if (migrated.cycle !== undefined) {
		throw conflict(
			"tag.merge.creates_cycle",
			"merging would create a cyclic parent rule; remove the conflicting rules first",
			{ sourceId, targetId, cycle: migrated.cycle },
		)
	}
	const ts = now()
	tx.delete(parentRules).run()
	if (migrated.rules.length > 0) {
		tx.insert(parentRules)
			.values(
				migrated.rules.map((r) => ({
					childKind: r.childKind,
					childId: r.childKind === "tag" ? r.childId : null,
					childCharacterId: r.childKind === "character" ? r.childId : null,
					parentId: r.parentId,
					createdAt: ts,
				})),
			)
			.run()
	}
	return migrated.movedCount
}

/**
 * Apply a `source → target` merge inside the caller's transaction:
 * migrate usages, migrate rules (blocking on cycles), delete the source,
 * and report how much moved.
 *
 * `migrateRules: false` runs on pre-rewrite databases during the
 * first-run dedupe, where the rule tables do not exist yet (and neither
 * do rules — nothing to migrate).
 */
export function applyTagMerge(
	tx: DbClient,
	sourceId: string,
	targetId: string,
	now: () => number,
	opts: { readonly migrateRules?: boolean } = {},
): TagMergeResult {
	assertMergeable(tx, sourceId, targetId)
	const movedResources = moveResourceUsages(tx, sourceId, targetId, now)
	const movedCharacters = moveCharacterUsages(tx, sourceId, targetId, now)
	const migrateRules = opts.migrateRules ?? true
	const movedSiblingRules = migrateRules
		? migrateSiblingRules(tx, sourceId, targetId, now)
		: 0
	const movedParentRules = migrateRules
		? migrateParentRules(tx, sourceId, targetId, now)
		: 0
	tx.delete(tags).where(eq(tags.id, sourceId)).run()
	return {
		targetId,
		movedResources,
		movedCharacters,
		movedSiblingRules,
		movedParentRules,
	}
}
