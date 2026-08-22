import { type SQL, sql } from "drizzle-orm"
import type { SQLiteColumn } from "drizzle-orm/sqlite-core"

/**
 * Escape character used with SQL `LIKE ... ESCAPE '\\'`. Declared once so
 * the escape symbol in {@link escapeLike} and {@link likeContainsLower}
 * can never drift out of sync.
 */
export const LIKE_ESCAPE_CHAR = "\\"

/**
 * Escape the wildcards (`%`, `_`) and the escape character (`\\`) itself
 * in a user-supplied LIKE fragment. The returned string is ready to be
 * spliced into a `%...?` pattern; it MUST be paired with an `ESCAPE '\\'`
 * clause (see {@link likeContainsLower}) or the escape sequences will be
 * treated as literals and the wildcards will still match.
 */
export function escapeLike(query: string): string {
	return query.replace(/[\\%_]/g, (ch) => `${LIKE_ESCAPE_CHAR}${ch}`)
}

/**
 * Build a case-insensitive `LOWER(col) LIKE ? ESCAPE '\\'` predicate where
 * the bind value is the escaped `%query%` pattern. SQLite's default `LIKE`
 * is ASCII-case-insensitive only, so wrapping both sides in `LOWER` gives
 * predictable behaviour for the non-ASCII strings users will throw at us.
 *
 * The escape-char literal (`\\`) is spelled inline rather than parameterised
 * because some drivers require `ESCAPE` to be a literal; keeping it close
 * to {@link LIKE_ESCAPE_CHAR} documents the coupling.
 */
export function likeContainsLower(col: SQLiteColumn, query: string): SQL {
	const pattern = `%${escapeLike(query).toLowerCase()}%`
	return sql`lower(${col}) LIKE ${pattern} ESCAPE '\\'`
}
