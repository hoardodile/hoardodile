import { withFileCommit } from "@hoardodile/host/hoard"
import {
	EMPTY_IMAGE_SLOT,
	type EntityMetaCreateInput,
	type EntityMetaUpdateInput,
	type Tag,
} from "@hoardodile/schemas"
import { conflict } from "@hoardodile/shared"
import { and, eq, inArray, isNull } from "drizzle-orm"
import { categories } from "src/domain/cat/schema.ts"
import { characters } from "src/domain/char/schema.ts"
import { resCharacters, resources } from "src/domain/res/schema.ts"
import { type DbClient, withTransaction } from "src/infra/db/connection.ts"
import { computeImageSlotFrom } from "src/infra/image-slots/meta.ts"
import type { MutableRef } from "src/infra/runtime-context.ts"
import {
	buildEntityMetaPatch,
	buildMaxPosition,
	buildReorder,
	type DbServiceDeps,
	resolveClock,
	resolveEntityMetaInsert,
	wrapAsync,
} from "src/infra/service.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"
import { loadParentRules, loadSiblingPairs } from "./collapse.ts"
import { buildTagFiles, TAG_IMAGE_SLOT } from "./files.ts"
import { ensureTagImageMeta, parseTagImageMeta } from "./image-meta.ts"
import {
	applyTagMerge,
	previewTagMerge,
	type TagMergePreview,
	type TagMergeResult,
} from "./merge.ts"
import { buildTagRepository, type TagDbPatch, type TagRow } from "./repo.ts"
import {
	charMemberIdsOf,
	charSiblingDisplayOf,
	type EndpointKind,
	endpointKey,
	findParentRuleCycle,
	hasSiblingCycle,
	isKindSetAllowed,
	type ParentRule,
	repointSiblingGroupOnDisplayDelete,
	type SiblingPair,
	siblingDisplayOf,
	siblingGroupOf,
} from "./rules.ts"
import {
	charTags,
	parentRules,
	resTags,
	siblingPairs,
	tags as tagsTable,
} from "./schema.ts"

export type { TagMergePreview, TagMergeResult } from "./merge.ts"

export type TagServiceDeps = DbServiceDeps & {
	readonly paths: StoragePaths
	readonly readOnly: MutableRef<boolean>
}

export type TagCreateInput = EntityMetaCreateInput & {
	readonly catId: string
	/** Optional external URL; trimmed, empty string means "no link". */
	readonly link?: string
}

export type TagUpdateInput = EntityMetaUpdateInput & {
	readonly catId?: string
	/** Optional external URL; trimmed, empty string clears the link. */
	readonly link?: string
}

export type TagWithCounts = Tag & {
	readonly resCount: number
	readonly charCount: number
}

/** One sibling group: members render as `displayTagId`, with union counts. */
export type TagSiblingGroup = {
	readonly displayTagId: string
	readonly memberTagIds: readonly string[]
	/** Character links that point into this group (avatar chip members). */
	readonly memberCharacters: readonly {
		readonly id: string
		readonly name: string
		readonly updatedAt: number
	}[]
	readonly resCount: number
	readonly charCount: number
}

/** One parent rule: entries carrying the child (a tag or a character)
 *  virtually also have `parentId`. */
export type TagParentRule = {
	readonly childKind: EndpointKind
	readonly childId: string
	readonly parentId: string
}

/**
 * Behaviour contract for the tag module. Tags are hard-deleted only (no
 * soft-delete). Attach/detach operations are idempotent. Tag identity is
 * `(namespace, name)`: a name is unique within its namespace, enforced
 * both here (trimmed, exact match — with a friendly "merge available"
 * error) and by a DB unique index.
 *
 * Sibling rules (M2): a `bad → good` pair makes the two tags synonyms;
 * groups are the transitive closure, every member renders as the group's
 * display tag, and filtering expands to whole groups. Pair creation
 * rejects cycles and kind bridges (common may pair with one kind only).
 *
 * Parent rules (M3): `child → parent` makes entries with the child
 * virtually carry the parent (transitively, never stored). Creation
 * rejects cycles and kind bridges; list-for-entity endpoints append the
 * virtual parents to the collapsed real tags.
 */
export type TagService = {
	listAll(): Promise<readonly Tag[]>
	listAllWithCounts(): Promise<readonly TagWithCounts[]>
	detail(id: string): Promise<Tag>
	create(input: TagCreateInput): Promise<Tag>
	update(input: TagUpdateInput): Promise<Tag>
	reorder(catId: string, ids: readonly string[]): Promise<void>
	delete(id: string): Promise<void>
	forceDelete(id: string, confirmName: string): Promise<void>

	/** Resolve the archive version pointer of the tag's image slot. */
	getImageVersion(id: string): Promise<number>
	/** Resolve the on-disk image path, or `undefined` when unset. */
	resolveImagePath(id: string): Promise<string | undefined>
	/**
	 * Install a new image under the current archive version (via
	 * `writeVersioned`), bumping `imageVersion` and refreshing the
	 * `imageMeta` projection.
	 */
	setImage(id: string, ext: string, sourcePath: string): Promise<Tag>
	/** Remove the image under the current version and reset the slot meta. */
	clearImage(id: string): Promise<Tag>

	mergePreview(sourceId: string, targetId: string): Promise<TagMergePreview>
	merge(sourceId: string, targetId: string): Promise<TagMergeResult>

	siblingGroups(): Promise<readonly TagSiblingGroup[]>
	siblingRuleCreate(input: {
		badKind?: EndpointKind
		badId: string
		goodId: string
	}): Promise<void>
	siblingRuleRemove(badId: string, badKind?: EndpointKind): Promise<void>
	siblingSetDisplay(tagId: string): Promise<void>

	parentRules(): Promise<readonly TagParentRule[]>
	parentRuleCreate(input: {
		childKind?: EndpointKind
		childId: string
		parentId: string
	}): Promise<void>
	parentRuleRemove(input: {
		childKind?: EndpointKind
		childId: string
		parentId: string
	}): Promise<void>

	listForResource(resId: string): Promise<readonly Tag[]>
	attachToResource(resId: string, tagId: string): Promise<void>
	detachFromResource(resId: string, tagId: string): Promise<void>
	bulkAttachToResource(ids: readonly string[], tagId: string): Promise<void>
	bulkDetachFromResource(ids: readonly string[], tagId: string): Promise<void>

	listForCharacter(charId: string): Promise<readonly Tag[]>
	attachToCharacter(charId: string, tagId: string): Promise<void>
	detachFromCharacter(charId: string, tagId: string): Promise<void>
	bulkAttachToCharacter(ids: readonly string[], tagId: string): Promise<void>
	bulkDetachFromCharacter(ids: readonly string[], tagId: string): Promise<void>
}

export function createTagService(deps: TagServiceDeps): TagService {
	const repo = buildTagRepository(deps.db)
	const files = buildTagFiles(deps.paths, deps.readOnly)
	const { now, newId } = resolveClock(deps)

	async function listAll(): Promise<readonly Tag[]> {
		await ensureImageMetaOf(repo.listAll())
		const displayOf = siblingDisplayMap()
		return repo.listAll().map((row) => rowToTag(row, displayOf(row.id)))
	}

	async function listAllWithCounts(): Promise<readonly TagWithCounts[]> {
		await ensureImageMetaOf(repo.listAll())
		const resCounts = repo.resUsageCounts()
		const charCounts = repo.charUsageCounts()
		const displayOf = siblingDisplayMap()
		return repo.listAll().map((row) => ({
			...rowToTag(row, displayOf(row.id)),
			resCount: resCounts.get(row.id) ?? 0,
			charCount: charCounts.get(row.id) ?? 0,
		}))
	}

	/** Fill missing image-meta projections for rows that have none. */
	async function ensureImageMetaOf(rows: readonly TagRow[]): Promise<void> {
		const missing = rows
			.filter((row) => row.imageMeta === null)
			.map((row) => row.id)
		if (missing.length === 0) return
		await ensureTagImageMeta(repo, files, missing)
	}

	function detail(id: string): Tag {
		const displayOf = siblingDisplayMap()
		return rowToTag(repo.findById(id), displayOf(id))
	}

	/**
	 * Map every tag id to the display tag it renders as (itself when
	 * ungrouped). Loads the sibling graph once per call.
	 */
	function siblingDisplayMap(): (tagId: string) => string {
		const pairs = loadPairs(deps.db)
		if (pairs.length === 0) return (tagId) => tagId
		const map = new Map<string, string>()
		for (const pair of pairs) {
			for (const id of [pair.badId, pair.goodId]) {
				if (map.has(id)) continue
				const display = siblingDisplayOf(pairs, id)
				if (display !== undefined) map.set(id, display)
			}
		}
		return (tagId) => map.get(tagId) ?? tagId
	}

	function loadPairs(client: DbClient): readonly SiblingPair[] {
		return loadSiblingPairs(client)
	}

	// ── Parent rules (M3) ───────────────────────────────────────────────────

	function parentRulesList(): readonly TagParentRule[] {
		return loadParentRules(deps.db)
	}

	/**
	 * Create a parent rule `child → parent`: entries carrying the child
	 * (a tag or a character) virtually also have the parent (transitively).
	 * The connected component is validated for cycles and kind isolation —
	 * common may chain with one other kind only, never bridging
	 * resource↔character; a character child counts as `character`.
	 */
	function parentRuleCreate(input: {
		readonly childKind?: EndpointKind
		readonly childId: string
		readonly parentId: string
	}): void {
		const childKind = input.childKind ?? "tag"
		const { childId, parentId } = input
		if (childKind === "tag" && childId === parentId) {
			throw conflict("tag.parent_rule.self", "a tag cannot imply itself", {
				childId,
			})
		}
		if (childKind === "character") {
			assertCharacterExists(childId)
		} else {
			repo.findById(childId)
		}
		repo.findById(parentId)
		withTransaction(deps.db, (tx) => {
			const rules = loadParentRules(tx)
			// Dedupe by identity before touching the graph: the PK carries
			// a NULL `child_id` for character rows, so SQLite's unique
			// index treats them as distinct and `onConflictDoNothing`
			// would not stop a repeat insert.
			if (
				rules.some(
					(rule) =>
						rule.childKind === childKind &&
						rule.childId === childId &&
						rule.parentId === parentId,
				)
			) {
				return
			}
			const proposed = [...rules, { childKind, childId, parentId }]
			if (findParentRuleCycle(proposed) !== undefined) {
				throw conflict(
					"tag.parent_rule.cycle",
					"this rule would create a parent cycle",
					{ childId, parentId },
				)
			}
			const kinds = componentKindsOf(tx, proposed, childKind, childId)
			if (!isKindSetAllowed(kinds)) {
				throw conflict(
					"tag.parent_rule.kind_isolation",
					"a parent chain may combine common with only one other kind",
					{ childId, parentId },
				)
			}
			tx.insert(parentRules)
				.values({
					childKind,
					childId: childKind === "tag" ? childId : null,
					childCharacterId: childKind === "character" ? childId : null,
					parentId,
					createdAt: now(),
				})
				.onConflictDoNothing()
				.run()
		})
	}

	/**
	 * The kinds of the undirected connected component containing
	 * `memberId` — the transitive isolation scope for parent chains.
	 * Character children count as `character` kind.
	 */
	function componentKindsOf(
		tx: DbClient,
		rules: readonly ParentRule[],
		memberKind: EndpointKind,
		memberId: string,
	): ReadonlySet<string> {
		const neighbors = new Map<string, string[]>()
		for (const rule of rules) {
			for (const [from, to] of [
				[
					endpointKey(rule.childKind, rule.childId),
					endpointKey("tag", rule.parentId),
				],
				[
					endpointKey("tag", rule.parentId),
					endpointKey(rule.childKind, rule.childId),
				],
			] as const) {
				const list = neighbors.get(from) ?? []
				list.push(to)
				neighbors.set(from, list)
			}
		}
		const component = new Set<string>()
		const stack = [endpointKey(memberKind, memberId)]
		while (stack.length > 0) {
			const id = stack.pop()
			if (id === undefined || component.has(id)) continue
			component.add(id)
			stack.push(...(neighbors.get(id) ?? []))
		}
		const tagIds = [...component]
			.filter((key) => key.startsWith("tag:"))
			.map((key) => key.slice("tag:".length))
		const catIds = new Set(
			tx
				.select({ catId: tagsTable.catId })
				.from(tagsTable)
				.where(inArray(tagsTable.id, tagIds))
				.all()
				.map((r) => r.catId)
				.filter((c): c is string => c !== null),
		)
		const kinds = new Set<string>()
		if (catIds.size > 0) {
			for (const row of tx
				.select({ kind: categories.kind })
				.from(categories)
				.where(inArray(categories.id, [...catIds]))
				.all()) {
				kinds.add(row.kind)
			}
		}
		if ([...component].some((k) => k.startsWith("character:"))) {
			kinds.add("character")
		}
		return kinds
	}

	function parentRuleRemove(input: {
		readonly childKind?: EndpointKind
		readonly childId: string
		readonly parentId: string
	}): void {
		const childKind = input.childKind ?? "tag"
		withTransaction(deps.db, (tx) => {
			tx.delete(parentRules)
				.where(
					and(
						eq(parentRules.childKind, childKind),
						childKind === "tag"
							? eq(parentRules.childId, input.childId)
							: eq(parentRules.childCharacterId, input.childId),
						eq(parentRules.parentId, input.parentId),
					),
				)
				.run()
		})
	}

	/**
	 * A character rule endpoint must reference a live (non-trashed)
	 * character; hard deletes cascade the rule away.
	 */
	function assertCharacterExists(charId: string): void {
		const row = deps.db
			.select({ id: characters.id })
			.from(characters)
			.where(and(eq(characters.id, charId), isNull(characters.deletedAt)))
			.get()
		if (row === undefined) {
			throw conflict("tag.rule.character_missing", "character not found", {
				charId,
			})
		}
	}

	function maxPositionForCatId(catId: string): number {
		return buildMaxPosition(repo.listAll, (t) => t.catId === catId)()
	}

	function create(input: TagCreateInput): Tag {
		assertNameAvailable(input.catId, input.name)
		const id = newId()
		const ts = now()
		const meta = resolveEntityMetaInsert(
			input,
			maxPositionForCatId(input.catId),
		)
		repo.insert(
			id,
			{
				name: input.name,
				...meta,
				link: input.link?.trim() ?? "",
				catId: input.catId,
			},
			ts,
		)
		return rowToTag(repo.findById(id))
	}

	function update(input: TagUpdateInput): Tag {
		const current = repo.findById(input.id)
		const catId = input.catId ?? current.catId
		const nameChanged =
			input.name !== undefined && input.name.trim() !== current.name.trim()
		if (catId !== null && (catId !== current.catId || nameChanged)) {
			assertNameAvailable(catId, input.name ?? current.name, input.id)
		}
		const patch: TagDbPatch = {
			...buildEntityMetaPatch(input, now()),
			...(input.catId !== undefined ? { catId: input.catId } : {}),
			...(input.link !== undefined ? { link: input.link.trim() } : {}),
		}
		repo.patch(input.id, patch)
		const displayOf = siblingDisplayMap()
		return rowToTag(repo.findById(input.id), displayOf(input.id))
	}

	/**
	 * Tag identity is (namespace, name): a name is unique within its
	 * namespace. Matching is trim + exact + case-sensitive per the PRD;
	 * the colliding tag's id is carried so clients can offer a merge.
	 */
	function assertNameAvailable(
		catId: string,
		name: string,
		excludeId?: string,
	): void {
		const normalized = name.trim()
		const existing = repo
			.listAll()
			.find(
				(t) =>
					t.catId === catId &&
					t.name.trim() === normalized &&
					t.id !== excludeId,
			)
		if (existing === undefined) return
		throw conflict(
			"tag.name_exists",
			`a tag named "${name.trim()}" already exists in this namespace — merge the duplicates to combine them`,
			{ catId, name: normalized, existingId: existing.id },
		)
	}

	function reorder(catId: string, ids: readonly string[]): void {
		buildReorder<TagRow>({
			entity: "tag",
			listAll: repo.listAll,
			patch: repo.patch,
			now,
			filter: (t) => t.catId === catId,
			filterMeta: { catId },
		})(ids)
	}

	async function deleteTag(id: string): Promise<void> {
		const row = repo.findById(id)
		assertNoUsages(id)
		reelectSiblingDisplay(id)
		await removeTagFolder(row)
		repo.remove(id)
	}

	async function forceDelete(id: string, confirmName: string): Promise<void> {
		const row = repo.findById(id)
		if (confirmName !== row.name) {
			throw conflict(
				"tag.confirm_name_mismatch",
				`provided name "${confirmName}" does not match tag name`,
				{ id, expected: row.name },
			)
		}
		reelectSiblingDisplay(id)
		await removeTagFolder(row)
		repo.remove(id)
	}

	/**
	 * Archive-version-aware cleanup of a tag's folder: bytes under the
	 * current version move to `local/trash/`, while bytes that live only
	 * under frozen past archives leave a `.deleted` placeholder in the
	 * current folder instead (mirrors character hard-delete).
	 */
	async function removeTagFolder(row: TagRow): Promise<void> {
		if (row.imageVersion === deps.paths.latestVersion) {
			await files.moveFolderToTrash(row.id)
		} else {
			await files.markDeleted(row.id)
		}
	}

	// ── Image slot ────────────────────────────────────────────────────────────

	async function getImageVersion(id: string): Promise<number> {
		return repo.findById(id).imageVersion
	}

	async function resolveImagePath(id: string): Promise<string | undefined> {
		const row = repo.findById(id)
		return files.findSlotInVersion(id, row.imageVersion, TAG_IMAGE_SLOT)
	}

	async function setImage(
		id: string,
		ext: string,
		sourcePath: string,
	): Promise<Tag> {
		repo.findById(id)
		await files.writeSlot(id, TAG_IMAGE_SLOT, ext, sourcePath)
		await clearImageThumb(id)
		const slot = await computeImageSlotFrom(() =>
			files.findSlotInVersion(id, deps.paths.latestVersion, TAG_IMAGE_SLOT),
		)
		repo.patch(id, {
			imageVersion: deps.paths.latestVersion,
			imageMeta: JSON.stringify(slot),
			updatedAt: now(),
		})
		return rowToTag(repo.findById(id))
	}

	async function clearImage(id: string): Promise<Tag> {
		repo.findById(id)
		await files.removeSlot(id, TAG_IMAGE_SLOT)
		await clearImageThumb(id)
		repo.patch(id, {
			imageVersion: deps.paths.latestVersion,
			imageMeta: JSON.stringify(EMPTY_IMAGE_SLOT),
			updatedAt: now(),
		})
		return rowToTag(repo.findById(id))
	}

	async function clearImageThumb(id: string): Promise<void> {
		const thumbPath = deps.paths.local.localCover(
			"tag",
			id,
			`v${deps.paths.latestVersion}-${TAG_IMAGE_SLOT}`,
		)
		const { unlink } = await import("node:fs/promises")
		await unlink(thumbPath).catch(() => {})
	}

	/**
	 * Deleting a sibling group's display tag re-elects the group's next
	 * display (most-used *tag* member, earliest created wins ties) instead
	 * of dissolving the group through the FK cascade. Character members
	 * are re-linked to the new display but never become display tags.
	 */
	function reelectSiblingDisplay(tagId: string): void {
		const pairs = loadPairs(deps.db)
		if (pairs.length === 0) return
		if (siblingDisplayOf(pairs, tagId) !== tagId) return
		const group = siblingGroupOf(pairs, tagId)
		const charIds = charMemberIdsOf(pairs, tagId)
		if (group.size - charIds.size <= 1) return
		const resCounts = repo.resUsageCounts()
		const charCounts = repo.charUsageCounts()
		const createdAt = new Map(
			repo.listAll().map((t) => [t.id, t.createdAt] as const),
		)
		const repointed = repointSiblingGroupOnDisplayDelete(
			pairs,
			tagId,
			(id) => (resCounts.get(id) ?? 0) + (charCounts.get(id) ?? 0),
			(id) => createdAt.get(id) ?? 0,
		)
		withTransaction(deps.db, (tx) => {
			tx.delete(siblingPairs).run()
			if (repointed.length > 0) {
				const ts = now()
				tx.insert(siblingPairs)
					.values(repointed.map((p) => pairRowValues(p, ts)))
					.run()
			}
		})
	}

	// ── Sibling rules (M2) ──────────────────────────────────────────────────

	function siblingGroups(): readonly TagSiblingGroup[] {
		const pairs = loadPairs(deps.db)
		if (pairs.length === 0) return []
		const involved = new Set<string>()
		for (const pair of pairs) {
			involved.add(endpointKey(pair.badKind, pair.badId))
			involved.add(`tag:${pair.goodId}`)
		}
		const groups = new Map<string, string[]>()
		for (const key of involved) {
			if (!key.startsWith("tag:")) continue
			const id = key.slice("tag:".length)
			const display = siblingDisplayOf(pairs, id)
			if (display === undefined || groups.has(display)) continue
			groups.set(display, [...siblingGroupOf(pairs, id)])
		}
		const charIdsByGroup = new Map<string, string[]>()
		for (const [displayTagId] of groups) {
			charIdsByGroup.set(displayTagId, [
				...charMemberIdsOf(pairs, displayTagId),
			])
		}
		const allCharIds = [...new Set([...charIdsByGroup.values()].flat())]
		const charRows = new Map(
			allCharIds.length === 0
				? []
				: deps.db
						.select({
							id: characters.id,
							name: characters.name,
							updatedAt: characters.updatedAt,
						})
						.from(characters)
						.where(inArray(characters.id, allCharIds))
						.all()
						.map((r) => [r.id, r] as const),
		)
		return [...groups.entries()].map(([displayTagId, members]) => {
			const charIds = new Set(charIdsByGroup.get(displayTagId) ?? [])
			const memberTagIds = members.filter((id) => !charIds.has(id))
			return {
				displayTagId,
				memberTagIds,
				memberCharacters: [...charIds]
					.map((id) => charRows.get(id))
					.filter(
						(r): r is { id: string; name: string; updatedAt: number } =>
							r !== undefined,
					),
				...groupUsageCounts(memberTagIds, [...charIds]),
			}
		})
	}

	function groupUsageCounts(
		tagIds: readonly string[],
		charIds: readonly string[],
	): {
		readonly resCount: number
		readonly charCount: number
	} {
		const resIds = new Set(
			deps.db
				.select({ id: resTags.resId })
				.from(resTags)
				.where(inArray(resTags.tagId, tagIds))
				.all()
				.map((r) => r.id),
		)
		const charIdsOfResources = new Set(
			charIds.length === 0
				? []
				: deps.db
						.select({ id: resCharacters.resId })
						.from(resCharacters)
						.where(inArray(resCharacters.charId, charIds))
						.all()
						.map((r) => r.id),
		)
		const charIdsSet = new Set(
			deps.db
				.select({ id: charTags.charId })
				.from(charTags)
				.where(inArray(charTags.tagId, tagIds))
				.all()
				.map((r) => r.id),
		)
		for (const id of charIds) charIdsSet.add(id)
		return {
			resCount:
				resIds.size +
				[...charIdsOfResources].filter((id) => !resIds.has(id)).length,
			charCount: charIdsSet.size,
		}
	}

	/**
	 * Create a sibling pair `bad → good`: the bad side (a tag or a
	 * character — a character link) renders as `good`. An endpoint can be
	 * the bad side of at most one pair: an existing pair for it is
	 * replaced. The merged group is validated for cycles and kind
	 * isolation — common may pair with one other kind, never a
	 * resource↔character bridge; a character member counts as `character`.
	 */
	function siblingRuleCreate(input: {
		readonly badKind?: EndpointKind
		readonly badId: string
		readonly goodId: string
	}): void {
		const badKind = input.badKind ?? "tag"
		const { badId, goodId } = input
		if (badKind === "tag" && badId === goodId) {
			throw conflict(
				"tag.sibling_pair.same_tag",
				"a tag cannot be a sibling of itself",
				{ badId },
			)
		}
		if (badKind === "character") {
			assertCharacterExists(badId)
		} else {
			repo.findById(badId)
		}
		repo.findById(goodId)
		withTransaction(deps.db, (tx) => {
			const pairs = loadPairs(tx)
			const proposed: readonly SiblingPair[] = [
				...pairs.filter(
					(p) =>
						endpointKey(p.badKind, p.badId) !== endpointKey(badKind, badId),
				),
				{ badKind, badId, goodId },
			]
			assertPairAddable(tx, proposed, badKind, badId)
			tx.delete(siblingPairs)
				.where(
					and(
						eq(siblingPairs.badKind, badKind),
						badKind === "tag"
							? eq(siblingPairs.badId, badId)
							: eq(siblingPairs.badCharacterId, badId),
					),
				)
				.run()
			tx.insert(siblingPairs)
				.values(pairRowValues({ badKind, badId, goodId }, now()))
				.run()
		})
	}

	function assertPairAddable(
		tx: DbClient,
		pairs: readonly SiblingPair[],
		badKind: EndpointKind,
		badId: string,
	): void {
		if (hasSiblingCycle(pairs)) {
			throw conflict(
				"tag.sibling_pair.cycle",
				"this pair would create a sibling cycle",
				{ badId },
			)
		}
		const kinds = siblingGroupKindsOf(tx, pairs, badKind, badId)
		if (!isKindSetAllowed(kinds)) {
			throw conflict(
				"tag.sibling_pair.kind_isolation",
				"a sibling group may combine common with only one other kind",
				{ badId },
			)
		}
	}

	function siblingGroupKindsOf(
		tx: DbClient,
		pairs: readonly SiblingPair[],
		badKind: EndpointKind,
		badId: string,
	): ReadonlySet<string> {
		const display =
			badKind === "character"
				? charSiblingDisplayOf(pairs, badId)
				: siblingDisplayOf(pairs, badId)
		const members =
			display === undefined
				? siblingGroupOf(pairs, badId)
				: siblingGroupOf(pairs, display)
		const charIds = charMemberIdsOf(pairs, display ?? badId)
		const catIds = new Set(
			tx
				.select({ catId: tagsTable.catId })
				.from(tagsTable)
				.where(inArray(tagsTable.id, [...members]))
				.all()
				.map((r) => r.catId)
				.filter((c): c is string => c !== null),
		)
		const kinds = new Set<string>()
		if (catIds.size > 0) {
			for (const row of tx
				.select({ kind: categories.kind })
				.from(categories)
				.where(inArray(categories.id, [...catIds]))
				.all()) {
				kinds.add(row.kind)
			}
		}
		if (charIds.size > 0) kinds.add("character")
		return kinds
	}

	function siblingRuleRemove(
		badId: string,
		badKind: EndpointKind = "tag",
	): void {
		withTransaction(deps.db, (tx) => {
			tx.delete(siblingPairs)
				.where(
					and(
						eq(siblingPairs.badKind, badKind),
						badKind === "tag"
							? eq(siblingPairs.badId, badId)
							: eq(siblingPairs.badCharacterId, badId),
					),
				)
				.run()
		})
	}

	/**
	 * Make `tagId` the display of its sibling group: every other member
	 * (tags and character links alike) is re-linked straight to it (a
	 * star rewrite).
	 */
	function siblingSetDisplay(tagId: string): void {
		repo.findById(tagId)
		withTransaction(deps.db, (tx) => {
			const pairs = loadPairs(tx)
			const display = siblingDisplayOf(pairs, tagId)
			if (display === undefined) {
				throw conflict(
					"tag.sibling_pair.ungrouped",
					"tag is not a sibling-group member",
					{ tagId },
				)
			}
			if (display === tagId) return
			const group = siblingGroupOf(pairs, tagId)
			const charIds = charMemberIdsOf(pairs, display)
			const tagMembers = [...group].filter((id) => !charIds.has(id))
			tx.delete(siblingPairs)
				.where(
					and(
						eq(siblingPairs.badKind, "tag"),
						inArray(siblingPairs.badId, tagMembers),
					),
				)
				.run()
			if (charIds.size > 0) {
				tx.delete(siblingPairs)
					.where(
						and(
							eq(siblingPairs.badKind, "character"),
							inArray(siblingPairs.badCharacterId, [...charIds]),
						),
					)
					.run()
			}
			const ts = now()
			const values: SiblingPair[] = [
				...tagMembers
					.filter((member) => member !== tagId)
					.map((member) => ({
						badKind: "tag" as const,
						badId: member,
						goodId: tagId,
					})),
				...[...charIds].map((member) => ({
					badKind: "character" as const,
					badId: member,
					goodId: tagId,
				})),
			]
			if (values.length > 0) {
				tx.insert(siblingPairs)
					.values(values.map((p) => pairRowValues(p, ts)))
					.run()
			}
		})
	}

	async function merge(
		sourceId: string,
		targetId: string,
	): Promise<TagMergeResult> {
		// The source keeps its own image/link; the target survives as-is.
		// Capture the source row before the transaction deletes it so the
		// folder bytes can be cleaned up afterwards.
		const sourceRow = repo.findById(sourceId)
		const result = withTransaction(deps.db, (tx) =>
			applyTagMerge(tx, sourceId, targetId, now),
		)
		await removeTagFolder(sourceRow)
		return result
	}

	function mergePreview(sourceId: string, targetId: string): TagMergePreview {
		return previewTagMerge(deps.db, sourceId, targetId)
	}

	function assertNoUsages(tagId: string): void {
		const resources = repo.countResourceUsages(tagId)
		const characters = repo.countCharacterUsages(tagId)
		if (resources > 0 || characters > 0) {
			throw conflict(
				"tag.has_dependencies",
				`tag ${tagId} is in use (${resources} resource(s), ${characters} character(s))`,
				{ id: tagId, resources, characters },
			)
		}
	}

	function touchResource(client: DbClient, resId: string): void {
		client
			.update(resources)
			.set({ updatedAt: now() })
			.where(eq(resources.id, resId))
			.run()
	}

	function touchCharacter(client: DbClient, charId: string): void {
		client
			.update(characters)
			.set({ updatedAt: now() })
			.where(eq(characters.id, charId))
			.run()
	}

	function attachToResource(resId: string, tagId: string): void {
		withTransaction(deps.db, (tx) => {
			tx.insert(resTags).values({ resId, tagId }).onConflictDoNothing().run()
			touchResource(tx, resId)
		})
	}

	function detachFromResource(resId: string, tagId: string): void {
		withTransaction(deps.db, (tx) => {
			tx.delete(resTags)
				.where(and(eq(resTags.resId, resId), eq(resTags.tagId, tagId)))
				.run()
			touchResource(tx, resId)
		})
	}

	function bulkAttachToResource(ids: readonly string[], tagId: string): void {
		if (ids.length === 0) return
		withTransaction(deps.db, (tx) => {
			tx.insert(resTags)
				.values(ids.map((resId) => ({ resId, tagId })))
				.onConflictDoNothing()
				.run()
			tx.update(resources)
				.set({ updatedAt: now() })
				.where(inArray(resources.id, ids))
				.run()
		})
	}

	function bulkDetachFromResource(ids: readonly string[], tagId: string): void {
		if (ids.length === 0) return
		withTransaction(deps.db, (tx) => {
			tx.delete(resTags)
				.where(and(inArray(resTags.resId, ids), eq(resTags.tagId, tagId)))
				.run()
			tx.update(resources)
				.set({ updatedAt: now() })
				.where(inArray(resources.id, ids))
				.run()
		})
	}

	function attachToCharacter(charId: string, tagId: string): void {
		withTransaction(deps.db, (tx) => {
			tx.insert(charTags).values({ charId, tagId }).onConflictDoNothing().run()
			touchCharacter(tx, charId)
		})
	}

	function detachFromCharacter(charId: string, tagId: string): void {
		withTransaction(deps.db, (tx) => {
			tx.delete(charTags)
				.where(and(eq(charTags.charId, charId), eq(charTags.tagId, tagId)))
				.run()
			touchCharacter(tx, charId)
		})
	}

	function bulkAttachToCharacter(ids: readonly string[], tagId: string): void {
		if (ids.length === 0) return
		withTransaction(deps.db, (tx) => {
			tx.insert(charTags)
				.values(ids.map((charId) => ({ charId, tagId })))
				.onConflictDoNothing()
				.run()
			tx.update(characters)
				.set({ updatedAt: now() })
				.where(inArray(characters.id, ids))
				.run()
		})
	}

	function bulkDetachFromCharacter(
		ids: readonly string[],
		tagId: string,
	): void {
		if (ids.length === 0) return
		withTransaction(deps.db, (tx) => {
			tx.delete(charTags)
				.where(and(inArray(charTags.charId, ids), eq(charTags.tagId, tagId)))
				.run()
			tx.update(characters)
				.set({ updatedAt: now() })
				.where(inArray(characters.id, ids))
				.run()
		})
	}

	const asyncOps = wrapAsync({
		listAll,
		listAllWithCounts,
		detail,
		create,
		update,
		reorder,
		delete: withFileCommit(deps.paths.root, deleteTag),
		forceDelete: withFileCommit(deps.paths.root, forceDelete),
		getImageVersion,
		resolveImagePath,
		setImage: withFileCommit(deps.paths.root, setImage),
		clearImage: withFileCommit(deps.paths.root, clearImage),
		mergePreview,
		merge: withFileCommit(deps.paths.root, merge),
		siblingGroups,
		siblingRuleCreate,
		siblingRuleRemove,
		siblingSetDisplay,
		parentRules: parentRulesList,
		parentRuleCreate,
		parentRuleRemove,
		attachToResource,
		detachFromResource,
		attachToCharacter,
		detachFromCharacter,
	})
	function collapseToDisplay(tags: readonly Tag[]): readonly Tag[] {
		const pairs = loadPairs(deps.db)
		if (pairs.length === 0) return tags
		const displayIds = [
			...new Set(tags.map((t) => siblingDisplayOf(pairs, t.id) ?? t.id)),
		]
		if (
			displayIds.length === tags.length &&
			displayIds.every((id, i) => id === tags[i]?.id)
		) {
			return tags
		}
		const rows = deps.db
			.select()
			.from(tagsTable)
			.where(inArray(tagsTable.id, displayIds))
			.all()
		const byId = new Map(rows.map((r) => [r.id, r]))
		return displayIds
			.map((id) => {
				const row = byId.get(id)
				return row === undefined ? undefined : rowToTag(row, id)
			})
			.filter((t): t is Tag => t !== undefined)
	}

	/**
	 * Append the virtual tags of a list-for-entity view: every tag the
	 * entity carries through rules — linked characters' display tags
	 * (character links) and the transitive parents of every carried
	 * group (tag or character members alike) — collapsed to their own
	 * display tags and flagged `virtual`. Virtual tags are never stored —
	 * this is purely the rendered view, and removing the underlying rule
	 * makes them disappear on the next fetch. Sibling linkage: a rule on
	 * any group member applies to the whole group.
	 */
	function withVirtualParents(
		tags: readonly Tag[],
		opts: { readonly characterIds?: readonly string[] } = {},
	): readonly Tag[] {
		const rules = loadParentRules(deps.db)
		const pairs = loadPairs(deps.db)
		const characterIds = opts.characterIds ?? []
		if (
			rules.length === 0 &&
			(characterIds.length === 0 || pairs.length === 0)
		) {
			return tags
		}
		const parentsOf = new Map<string, string[]>()
		for (const rule of rules) {
			const list =
				parentsOf.get(endpointKey(rule.childKind, rule.childId)) ?? []
			list.push(rule.parentId)
			parentsOf.set(endpointKey(rule.childKind, rule.childId), list)
		}
		// Walk the graph first to collect the virtual display ids, then
		// fetch exactly those rows (the graph walk only needs the rules).
		const groupOf = (id: string) =>
			pairs.length === 0 ? new Set<string>([id]) : siblingGroupOf(pairs, id)
		const toDisplay = (id: string) =>
			pairs.length === 0 ? id : (siblingDisplayOf(pairs, id) ?? id)
		const pushParents = (stack: string[], id: string) => {
			for (const member of groupOf(id)) {
				stack.push(...(parentsOf.get(`tag:${member}`) ?? []))
			}
			for (const member of charMemberIdsOf(pairs, id)) {
				stack.push(...(parentsOf.get(`character:${member}`) ?? []))
			}
		}

		const virtualIds: string[] = []
		const seen = new Set(tags.map((t) => t.id))
		const carried: string[] = [...tags.map((t) => t.id)]
		for (const charId of characterIds) {
			const display =
				pairs.length === 0 ? undefined : charSiblingDisplayOf(pairs, charId)
			if (display === undefined || seen.has(display)) continue
			seen.add(display)
			virtualIds.push(display)
			carried.push(display)
		}
		const stack: string[] = []
		for (const id of carried) pushParents(stack, id)
		// A character-child parent rule applies wherever the character is
		// carried — directly, no sibling link needed.
		for (const charId of characterIds) {
			stack.push(...(parentsOf.get(`character:${charId}`) ?? []))
		}
		while (stack.length > 0) {
			const parentId = stack.pop()
			if (parentId === undefined) continue
			const displayId = toDisplay(parentId)
			if (seen.has(displayId)) continue
			seen.add(displayId)
			virtualIds.push(displayId)
			pushParents(stack, displayId)
		}
		if (virtualIds.length === 0) return tags
		const rowById = new Map(
			deps.db
				.select()
				.from(tagsTable)
				.where(inArray(tagsTable.id, virtualIds))
				.all()
				.map((r) => [r.id, r]),
		)
		return [
			...tags,
			...virtualIds
				.map((id) => {
					const row = rowById.get(id)
					return row === undefined ? undefined : rowToTag(row, id, true)
				})
				.filter((t): t is Tag => t !== undefined),
		]
	}

	function resourceCharacterIds(resId: string): readonly string[] {
		return deps.db
			.select({ id: resCharacters.charId })
			.from(resCharacters)
			.where(eq(resCharacters.resId, resId))
			.all()
			.map((r) => r.id)
	}

	/** A sibling pair row with the polymorphic columns split out. */
	function pairRowValues(
		pair: SiblingPair,
		ts: number,
	): {
		readonly badKind: "tag" | "character"
		readonly badId: string | null
		readonly badCharacterId: string | null
		readonly goodId: string
		readonly createdAt: number
	} {
		return {
			badKind: pair.badKind,
			badId: pair.badKind === "tag" ? pair.badId : null,
			badCharacterId: pair.badKind === "character" ? pair.badId : null,
			goodId: pair.goodId,
			createdAt: ts,
		}
	}

	return {
		...asyncOps,
		bulkAttachToResource: async (ids, tagId) =>
			bulkAttachToResource(ids, tagId),
		bulkDetachFromResource: async (ids, tagId) =>
			bulkDetachFromResource(ids, tagId),
		bulkAttachToCharacter: async (ids, tagId) =>
			bulkAttachToCharacter(ids, tagId),
		bulkDetachFromCharacter: async (ids, tagId) =>
			bulkDetachFromCharacter(ids, tagId),
		listForResource: async (id) =>
			withVirtualParents(
				collapseToDisplay(repo.listForResource(id).map((row) => rowToTag(row))),
				{ characterIds: resourceCharacterIds(id) },
			),
		listForCharacter: async (id) =>
			withVirtualParents(
				collapseToDisplay(
					repo.listForCharacter(id).map((row) => rowToTag(row)),
				),
				{ characterIds: [id] },
			),
	}
}

/**
 * Replace every tag with its sibling-group display row: members never
 * render under their own name, and a display that is not itself attached
 * to the entity still shows (it is fetched from the tag table). Order
 * follows first member occurrence.
 */
function rowToTag(row: TagRow, displayTagId = row.id, virtual = false): Tag {
	const imageMeta = parseTagImageMeta(row.imageMeta)
	return {
		id: row.id,
		name: row.name,
		intro: row.intro,
		color: row.color,
		link: row.link,
		...(imageMeta !== undefined ? { imageMeta } : {}),
		position: row.position,
		pinned: row.pinned,
		catId: row.catId!,
		displayTagId,
		...(virtual ? { virtual: true as const } : {}),
		createdAt: row.createdAt,
		updatedAt: row.updatedAt,
	}
}
