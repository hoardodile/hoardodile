import { sql } from "drizzle-orm"
import {
	check,
	integer,
	primaryKey,
	sqliteTable,
	text,
	uniqueIndex,
} from "drizzle-orm/sqlite-core"
import { categories } from "src/domain/cat/schema.ts"
import { characters } from "src/domain/char/schema.ts"
import { resources } from "src/domain/res/schema.ts"

/**
 * Domain table for {@link import("@hoardodile/schemas").Tag}. `category_id` is
 * required at the application level — uncategorized tags are not allowed.
 * Tags are hard-deleted only. Tag identity is `(category_id, name)`; the
 * pair is unique within the namespace.
 */
export const tags = sqliteTable(
	"tags",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		intro: text("intro").notNull().default(""),
		color: text("color").notNull().default(""),
		link: text("link").notNull().default(""),
		/**
		 * Archive version where this tag's `image.<ext>` file lives.
		 * Writes always target the latest version; the pointer lets reads
		 * fall back to frozen archives exactly like character slots.
		 */
		imageVersion: integer("image_version").notNull().default(1),
		/**
		 * Rebuildable JSON projection of the image slot (see
		 * `@hoardodile/schemas` `imageSlotMeta`). NULL means "not computed
		 * yet"; `{ empty: true }` means "computed, no file". Disk stays the
		 * byte SSOT.
		 */
		imageMeta: text("image_meta"),
		position: integer("position").notNull().default(0),
		pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
		catId: text("category_id").references(() => categories.id, {
			onDelete: "set null",
		}),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	// Tag identity: name is unique within its namespace. The first-run
	// dedupe (domain/tag/dedupe.ts) runs BEFORE migrations on pre-rewrite
	// databases so legacy duplicates cannot break index creation.
	(t) => [uniqueIndex("tags_category_name_unique").on(t.catId, t.name)],
)

/** Join table between resources and tags. Cascade on both sides. */
export const resTags = sqliteTable(
	"resource_tags",
	{
		resId: text("resource_id")
			.notNull()
			.references(() => resources.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
	},
	(t) => [primaryKey({ columns: [t.resId, t.tagId] })],
)

/** Join table between characters and tags. Cascade on both sides. */
export const charTags = sqliteTable(
	"character_tags",
	{
		charId: text("character_id")
			.notNull()
			.references(() => characters.id, { onDelete: "cascade" }),
		tagId: text("tag_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
	},
	(t) => [primaryKey({ columns: [t.charId, t.tagId] })],
)

/**
 * Directed sibling rule `bad → good`: the pair are synonyms and every
 * occurrence of the bad side renders as `good` (always a tag — a character
 * can link to a tag, never the reverse). `badKind` discriminates the
 * endpoint: `tag` rows point into `tags` via `badId`, `character` rows
 * into `characters` via `badCharacterId`; exactly one is set. A bad
 * endpoint is unique, so it can be the bad side of at most one pair;
 * sibling groups are the transitive closure of these pairs, computed at
 * read time (see `domain/tag/rules.ts`). Cascade deletes keep the graph
 * consistent when a tag or character is removed.
 */
export const siblingPairs = sqliteTable(
	"sibling_pairs",
	{
		badKind: text("bad_kind", { enum: ["tag", "character"] })
			.notNull()
			.default("tag"),
		badId: text("bad_id").references(() => tags.id, { onDelete: "cascade" }),
		badCharacterId: text("bad_character_id").references(() => characters.id, {
			onDelete: "cascade",
		}),
		goodId: text("good_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
		createdAt: integer("created_at").notNull(),
	},
	(t) => [
		primaryKey({ columns: [t.badKind, t.badId, t.badCharacterId] }),
		check(
			"sibling_pairs_endpoint_exclusive",
			sql`(
				(${t.badKind} = 'tag' AND ${t.badId} IS NOT NULL AND ${t.badCharacterId} IS NULL)
				OR
				(${t.badKind} = 'character' AND ${t.badId} IS NULL AND ${t.badCharacterId} IS NOT NULL)
			)`,
		),
	],
)

/**
 * Directed parent rule `child → parent`: any entry carrying the child
 * (a tag, or a character — character rules make resources linked to the
 * character virtually carry the parent) also has `parent` (transitively).
 * Parents are always tags. Parents are never written to entries; the
 * rules are applied at display/search time. Cascade deletes keep the
 * graph consistent when a tag or character is removed.
 */
export const parentRules = sqliteTable(
	"parent_rules",
	{
		childKind: text("child_kind", { enum: ["tag", "character"] })
			.notNull()
			.default("tag"),
		childId: text("child_id").references(() => tags.id, {
			onDelete: "cascade",
		}),
		childCharacterId: text("child_character_id").references(
			() => characters.id,
			{ onDelete: "cascade" },
		),
		parentId: text("parent_id")
			.notNull()
			.references(() => tags.id, { onDelete: "cascade" }),
		createdAt: integer("created_at").notNull(),
	},
	(t) => [
		primaryKey({
			columns: [t.childKind, t.childId, t.childCharacterId, t.parentId],
		}),
		check(
			"parent_rules_child_endpoint_exclusive",
			sql`(
				(${t.childKind} = 'tag' AND ${t.childId} IS NOT NULL AND ${t.childCharacterId} IS NULL)
				OR
				(${t.childKind} = 'character' AND ${t.childId} IS NULL AND ${t.childCharacterId} IS NOT NULL)
			)`,
		),
	],
)
