import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

export const auth = sqliteTable("auth", {
	singleton: integer("singleton").primaryKey().default(1).notNull(),
	passwordHash: text("password_hash").notNull(),
	updatedAt: integer("updated_at").notNull(),
	/**
	 * Whether the current password fails the cheap strength check (short
	 * or all-digit). Recomputed on setup, password change, and every
	 * successful login; the desktop shell reads it before enabling
	 * local-network sharing.
	 */
	weakPassword: integer("weak_password").notNull().default(0),
})

/**
 * One row per successful login. Sessions are stateless sealed cookies and
 * every login rotates to a fresh session id, so a row is a login event
 * rather than a live session. The UI surfaces the newest rows as "recent
 * connections"; rows older than 90 days are pruned on write.
 */
export const authSignIns = sqliteTable(
	"auth_sign_ins",
	{
		/** Session id issued by that login. */
		id: text("id").primaryKey(),
		/** Remote address of the login, e.g. `192.168.1.50`. */
		ip: text("ip").notNull(),
		/** `loopback` (127.0.0.1/::1) or `lan` (everything else). */
		origin: text("origin").notNull().$type<"loopback" | "lan">(),
		/** Parsed device label; the raw user agent is never stored. */
		deviceLabel: text("device_label").notNull(),
		recordedAt: integer("recorded_at").notNull(),
	},
	(t) => [index("auth_sign_ins_recorded_idx").on(t.recordedAt)],
)

export type AuthSignInRow = typeof authSignIns.$inferSelect
export type AuthSignInInsert = typeof authSignIns.$inferInsert
