import { sql } from "drizzle-orm"
import {
	check,
	index,
	integer,
	sqliteTable,
	text,
} from "drizzle-orm/sqlite-core"

/**
 * Domain table for {@link import("@hoardodile/schemas").Character}. Tag
 * associations live in the `character_tags` join table. `trait_values`
 * holds a JSON object keyed by trait definition id. Images live by
 * convention in the character folder (`avatar.<ext>`, `fullbody.<ext>`).
 * Soft deletion is tracked via `deleted_at`.
 */
export const characters = sqliteTable(
	"characters",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		intro: text("intro").notNull().default(""),
		traitValues: text("trait_values").notNull().default("{}"),
		/**
		 * Archive version where this character's `avatar.<ext>` file lives.
		 * Bumped on every avatar write to the current version.
		 */
		avatarVersion: integer("avatar_version").notNull().default(1),
		/** Archive version where this character's `fullbody.<ext>` file lives. */
		fullbodyVersion: integer("fullbody_version").notNull().default(1),
		/**
		 * Rebuildable JSON projection of avatar/fullbody files
		 * (`CharImageMeta`). Null means not computed yet.
		 */
		imageMeta: text("image_meta"),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
		deletedAt: integer("deleted_at"),
	},
	(t) => [
		index("characters_deleted_at_idx").on(t.deletedAt),
		index("characters_created_at_idx").on(t.createdAt),
	],
)

/**
 * Named relationship type (e.g. "Friend", "Mentor/Apprentice"). `selfLabel`
 * is the label for the self->target direction; `targetLabel` is for target->self.
 * Semantic fields (`kind`, `hierarchyFrom`) drive edge validation.
 */
export const relationshipTypes = sqliteTable(
	"relationship_types",
	{
		id: text("id").primaryKey(),
		name: text("name").notNull(),
		selfLabel: text("self_label").notNull().default(""),
		targetLabel: text("target_label").notNull().default(""),
		kind: text("kind").notNull().default("directed"),
		hierarchyFrom: text("hierarchy_from"),
		position: integer("position").notNull().default(0),
		intro: text("intro").notNull().default(""),
		color: text("color").notNull().default(""),
		pinned: integer("pinned", { mode: "boolean" }).notNull().default(false),
		createdAt: integer("created_at").notNull(),
		updatedAt: integer("updated_at").notNull(),
	},
	(t) => [index("relationship_types_position_idx").on(t.position)],
)

/**
 * A relationship edge of a given {@link relationshipTypes} entry.
 * Either both endpoints are characters, or exactly one endpoint is a
 * character and the other is an external name. The unique index treats
 * NULL self_id as a sentinel so external-self edges do not duplicate.
 */
export const characterships = sqliteTable(
	"characterships",
	{
		id: text("id").primaryKey(),
		typeId: text("type_id")
			.notNull()
			.references(() => relationshipTypes.id, { onDelete: "cascade" }),
		selfId: text("self_id").references(() => characters.id, {
			onDelete: "cascade",
		}),
		targetId: text("target_id").references(() => characters.id, {
			onDelete: "cascade",
		}),
		externalName: text("external_name").notNull().default(""),
		notes: text("notes").notNull().default(""),
		metadata: text("metadata").notNull().default("{}"),
		createdAt: integer("created_at").notNull(),
	},
	(t) => [
		index("characterships_self_id_idx").on(t.selfId),
		index("characterships_target_id_idx").on(t.targetId),
		check(
			"characterships_no_self_loop",
			sql`${t.selfId} IS NULL OR ${t.targetId} IS NULL OR ${t.selfId} != ${t.targetId}`,
		),
		check(
			"characterships_endpoint_xor_external",
			sql`(
				(${t.selfId} IS NOT NULL AND ${t.targetId} IS NOT NULL AND ${t.externalName} = '')
				OR
				(
					((${t.selfId} IS NOT NULL AND ${t.targetId} IS NULL) OR (${t.selfId} IS NULL AND ${t.targetId} IS NOT NULL))
					AND length(${t.externalName}) > 0
				)
			)`,
		),
	],
)
