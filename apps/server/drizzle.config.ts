import { tmpdir } from "node:os"
import { resolve } from "node:path"
import { defineConfig } from "drizzle-kit"

const DEFAULT_STORAGE_ROOT = resolve(tmpdir(), "app-dev")
const storageRoot = process.env.STORAGE_ROOT ?? DEFAULT_STORAGE_ROOT
const dbUrl = process.env.DATABASE_URL ?? resolve(storageRoot, "app.sqlite")

/**
 * Drizzle Kit configuration for generating and applying SQLite migrations.
 *
 * - `schema` points at the barrel that re-exports every table definition
 *   so the generator sees the full schema graph.
 * - `out` is the folder Drizzle Kit writes / reads migrations from. The
 *   runtime migrator (see `src/infra/db/connection.ts`) reads the same
 *   folder at startup, so the two must agree.
 *
 * Schema-diff commands:
 *
 *   pnpm -F @hoardodile/server exec drizzle-kit generate
 *   pnpm -F @hoardodile/server exec drizzle-kit migrate   # standalone runner
 *
 * The app does NOT invoke `drizzle-kit migrate` at runtime -- it calls the
 * in-process `migrate()` from `drizzle-orm/better-sqlite3/migrator` to
 * avoid shipping the dev toolchain. See `src/infra/db/connection.ts`.
 *
 * After a baseline squash, existing libraries whose tables already match
 * should stamp bookkeeping instead of replaying `0000_*.sql`:
 *   node scripts/stamp-drizzle-migrations.mjs <storageRoot>
 */
export default defineConfig({
	schema: "./src/infra/db/schema.ts",
	out: "./src/infra/db/migrations",
	dialect: "sqlite",
	dbCredentials: { url: dbUrl },
})
