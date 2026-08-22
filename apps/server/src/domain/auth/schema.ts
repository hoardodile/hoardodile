import { integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const auth = sqliteTable("auth", {
	singleton: integer("singleton").primaryKey().default(1).notNull(),
	passwordHash: text("password_hash").notNull(),
	updatedAt: integer("updated_at").notNull(),
})
