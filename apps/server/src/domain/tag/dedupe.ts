import { randomUUID } from "node:crypto"
import { count, eq, isNull, sql } from "drizzle-orm"
import { categories } from "src/domain/cat/schema.ts"
import {
	type DbClient,
	type SqliteDb,
	withTransaction,
} from "src/infra/db/connection.ts"
import { migrationRuns } from "src/infra/db/runs-schema.ts"
import { applyTagMerge } from "./merge.ts"
import { charTags, resTags, tags } from "./schema.ts"

/**
 * First-run dedupe for the tag-system rewrite: removes every duplicate
 * namespace and duplicate tag, moves orphan tags into a default namespace,
 * and (on the post-migration pass) records its outcome in `migration_runs`
 * so it never runs twice.
 *
 * The migration runner applies ALL pending migrations in one go, so the
 * unique-name indexes would fail to create on legacy data with duplicate
 * names. The dedupe therefore runs in two phases, both at boot:
 *
 * 1. **Pre-migration** (`runPreMigrationTagDedupe`) — only on databases
 *    that predate the rule tables: clears duplicates while the schema
 *    still allows them, so the index migration can apply. No rules exist
 *    on such databases, so no rule migration happens here.
 * 2. **Post-migration** (`runTagDedupe`) — the full pass: rules are
 *    migrated via {@link applyTagMerge}, and the outcome is recorded.
 *    On upgraded databases this is a no-op that verifies the state; on
 *    fresh installs it records the trivial run.
 *
 * Both phases are merge applied at startup — duplicates are merged with
 * the same semantics as the interactive merge — and both are idempotent:
 * duplicates are re-computed from the current state on every run, so a
 * crashed boot simply redoes (a suffix of) the work.
 *
 * `dryRun` logs exactly what would happen without touching data; release
 * notes list the merge decisions from the log. A dry-run boot cannot
 * complete a legacy upgrade (the index migration would still fail), so
 * dry-run is for preview only.
 */

/** Key under which the post-migration dedupe outcome is recorded. */
export const TAG_DEDUPE_RUN_NAME = "tag-dedupe-v1"

/**
 * Namespace created when orphan tags (category_id NULL, only possible from
 * pre-rewrite data) are found. A user namespace with this name wins over a
 * fresh one; mention the name in release notes.
 */
export const DEFAULT_NAMESPACE_NAME = "Uncategorized"

export type TagDedupeRun = {
	readonly skipped: boolean
	readonly dryRun: boolean
	readonly namespacesMerged: number
	readonly tagsMerged: number
	readonly orphansMoved: number
	readonly defaultNamespaceCreated: boolean
}

export type TagDedupeOptions = {
	readonly dryRun?: boolean
	readonly now?: () => number
	readonly log?: (
		msg: string,
		details?: Readonly<Record<string, unknown>>,
	) => void
}

/**
 * Whether the rule tables exist. False on databases that predate the
 * rewrite — the pre-migration dedupe pass is only needed there.
 */
export function hasTagRuleTables(client: DbClient): boolean {
	const row = client.get<{ readonly n: number }>(
		sql`SELECT count(*) AS n FROM sqlite_master
			    WHERE type = 'table' AND name IN ('sibling_pairs', 'parent_rules')`,
	)
	return (row?.n ?? 0) === 2
}

/**
 * Whether the database carries the pre-rewrite tag schema: the tag tables
 * exist but the rule tables do not. A brand-new database (nothing
 * migrated yet) and a fully migrated one are both false — only the
 * in-between state needs the pre-migration dedupe pass.
 */
export function hasPreRewriteTagSchema(client: DbClient): boolean {
	const tables = client.all<{ readonly name: string }>(
		sql`SELECT name FROM sqlite_master WHERE type = 'table'`,
	)
	const names = new Set(tables.map((t) => t.name))
	return (
		names.has("categories") && names.has("tags") && !names.has("sibling_pairs")
	)
}

/** Post-migration pass: full dedupe with rule migration, recorded. */
export function runTagDedupe(
	client: SqliteDb,
	opts: TagDedupeOptions = {},
): TagDedupeRun {
	return withTransaction(client, (tx) =>
		runDedupeIn(tx, opts, { migrateRules: true, record: true }),
	)
}

/** Pre-migration pass: legacy cleanup without rule tables, not recorded. */
export function runPreMigrationTagDedupe(
	client: SqliteDb,
	opts: TagDedupeOptions = {},
): TagDedupeRun {
	return withTransaction(client, (tx) =>
		runDedupeIn(tx, opts, { migrateRules: false, record: false }),
	)
}

function runDedupeIn(
	tx: Parameters<Parameters<SqliteDb["transaction"]>[0]>[0],
	opts: TagDedupeOptions,
	mode: { readonly migrateRules: boolean; readonly record: boolean },
): TagDedupeRun {
	const { dryRun = false, now = Date.now, log = () => {} } = opts
	const runName = TAG_DEDUPE_RUN_NAME

	if (mode.record) {
		const alreadyRun = tx
			.select({ value: count() })
			.from(migrationRuns)
			.where(eq(migrationRuns.name, runName))
			.get()
		if ((alreadyRun?.value ?? 0) > 0) {
			return {
				skipped: true,
				dryRun,
				namespacesMerged: 0,
				tagsMerged: 0,
				orphansMoved: 0,
				defaultNamespaceCreated: false,
			}
		}
	}

	const ctx = { dryRun, now, log }
	const namespacesMerged = dedupeNamespaces(tx, ctx)
	const { orphansMoved, defaultNamespaceCreated } = moveOrphans(tx, ctx)
	const tagsMerged = dedupeTags(tx, ctx, mode.migrateRules)

	const run: TagDedupeRun = {
		skipped: false,
		dryRun,
		namespacesMerged,
		tagsMerged,
		orphansMoved,
		defaultNamespaceCreated,
	}
	if (mode.record && !dryRun) {
		tx.insert(migrationRuns)
			.values({
				name: runName,
				ranAt: now(),
				payload: JSON.stringify(run),
			})
			.run()
	}
	return run
}

type DedupeCtx = {
	readonly dryRun: boolean
	readonly now: () => number
	readonly log: NonNullable<TagDedupeOptions["log"]>
}

/**
 * Merge namespaces whose trimmed names collide: the survivor is the one
 * with the most tags (earliest created wins ties); its tags and rules
 * (rules reference tags, never namespaces) go with the tags.
 */
function dedupeNamespaces(tx: DbClient, ctx: DedupeCtx): number {
	const rows = tx.select().from(categories).all()
	const tagCounts = new Map<string, number>()
	for (const row of tx
		.select({ catId: tags.catId, value: count() })
		.from(tags)
		.groupBy(tags.catId)
		.all()) {
		if (row.catId !== null) tagCounts.set(row.catId, row.value)
	}
	const byName = new Map<string, typeof rows>()
	for (const row of rows) {
		const name = row.name.trim()
		if (name.length === 0) continue
		const group = byName.get(name) ?? []
		group.push(row)
		byName.set(name, group)
	}

	let merged = 0
	for (const group of byName.values()) {
		if (group.length < 2) continue
		const survivor = pickSurvivor(group, (r) => tagCounts.get(r.id) ?? 0)
		for (const loser of group) {
			if (loser.id === survivor.id) continue
			const movedTags = tagCounts.get(loser.id) ?? 0
			ctx.log("tag-dedupe.namespace.merge", {
				name: group[0]?.name.trim(),
				survivorId: survivor.id,
				loserId: loser.id,
				movedTags,
			})
			merged++
			if (ctx.dryRun) continue
			tx.update(tags)
				.set({ catId: survivor.id, updatedAt: ctx.now() })
				.where(eq(tags.catId, loser.id))
				.run()
			tx.delete(categories).where(eq(categories.id, loser.id)).run()
		}
	}
	return merged
}

/**
 * Move orphan tags (category_id NULL) into the default namespace, created
 * on demand if no namespace carries the default name.
 */
function moveOrphans(
	tx: DbClient,
	ctx: DedupeCtx,
): {
	readonly orphansMoved: number
	readonly defaultNamespaceCreated: boolean
} {
	const orphans = tx
		.select({ value: count() })
		.from(tags)
		.where(isNull(tags.catId))
		.get()
	const orphanCount = orphans?.value ?? 0
	if (orphanCount === 0) {
		return { orphansMoved: 0, defaultNamespaceCreated: false }
	}
	let defaultId: string | undefined = tx
		.select({ id: categories.id })
		.from(categories)
		.where(eq(categories.name, DEFAULT_NAMESPACE_NAME))
		.get()?.id
	let created = false
	if (defaultId === undefined) {
		ctx.log("tag-dedupe.namespace.create", {
			name: DEFAULT_NAMESPACE_NAME,
			orphans: orphanCount,
		})
		created = true
		if (!ctx.dryRun) {
			defaultId = randomUUID()
			const ts = ctx.now()
			tx.insert(categories)
				.values({
					id: defaultId,
					name: DEFAULT_NAMESPACE_NAME,
					intro: "",
					color: "",
					kind: "common",
					position: 0,
					pinned: false,
					createdAt: ts,
					updatedAt: ts,
				})
				.run()
		}
	}
	if (defaultId === undefined) {
		return { orphansMoved: orphanCount, defaultNamespaceCreated: created }
	}
	ctx.log("tag-dedupe.orphans.move", { orphans: orphanCount })
	if (!ctx.dryRun) {
		tx.update(tags)
			.set({ catId: defaultId, updatedAt: ctx.now() })
			.where(isNull(tags.catId))
			.run()
	}
	return { orphansMoved: orphanCount, defaultNamespaceCreated: created }
}

/**
 * Merge tags whose (namespace, trimmed name) collide: the survivor is the
 * most-used tag (resources + characters, earliest created wins ties);
 * losers are merged via {@link applyTagMerge}.
 */
function dedupeTags(
	tx: DbClient,
	ctx: DedupeCtx,
	migrateRules: boolean,
): number {
	const rows = tx.select().from(tags).all()
	const usage = new Map<string, number>()
	for (const row of tx
		.select({ tagId: resTags.tagId, value: count() })
		.from(resTags)
		.groupBy(resTags.tagId)
		.all()) {
		usage.set(row.tagId, (usage.get(row.tagId) ?? 0) + row.value)
	}
	for (const row of tx
		.select({ tagId: charTags.tagId, value: count() })
		.from(charTags)
		.groupBy(charTags.tagId)
		.all()) {
		usage.set(row.tagId, (usage.get(row.tagId) ?? 0) + row.value)
	}
	const byKey = new Map<string, typeof rows>()
	for (const row of rows) {
		if (row.catId === null) continue
		const name = row.name.trim()
		if (name.length === 0) continue
		const key = `${row.catId}\u0000${name}`
		const group = byKey.get(key) ?? []
		group.push(row)
		byKey.set(key, group)
	}

	let merged = 0
	for (const group of byKey.values()) {
		if (group.length < 2) continue
		const survivor = pickSurvivor(group, (r) => usage.get(r.id) ?? 0)
		for (const loser of group) {
			if (loser.id === survivor.id) continue
			ctx.log("tag-dedupe.tag.merge", {
				name: group[0]?.name.trim(),
				catId: group[0]?.catId,
				survivorId: survivor.id,
				loserId: loser.id,
			})
			merged++
			if (!ctx.dryRun) {
				applyTagMerge(tx, loser.id, survivor.id, ctx.now, {
					migrateRules,
				})
			}
		}
	}
	return merged
}

/** Most-used wins; earliest created (then id) breaks ties. */
function pickSurvivor<TRow extends { id: string; createdAt: number }>(
	group: readonly TRow[],
	usageOf: (row: TRow) => number,
): TRow {
	return group.reduce((best, row) => {
		const usage = usageOf(row)
		const bestUsage = usageOf(best)
		if (usage > bestUsage) return row
		if (usage < bestUsage) return best
		if (row.createdAt < best.createdAt) return row
		if (row.createdAt > best.createdAt) return best
		return row.id < best.id ? row : best
	})
}
