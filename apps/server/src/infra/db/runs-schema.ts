import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * One-shot startup data-migration bookkeeping (e.g. the first-run tag
 * dedupe). Schema migrations live in Drizzle-Kit migrations; DATA
 * migrations that must run exactly once record their outcome here so
 * startup scripts stay idempotent across restarts.
 */
export const migrationRuns = sqliteTable("migration_runs", {
	name: text("name").primaryKey(),
	ranAt: integer("ran_at").notNull(),
	/** JSON payload describing what the run changed (or would change). */
	payload: text("payload").notNull().default("{}"),
})
