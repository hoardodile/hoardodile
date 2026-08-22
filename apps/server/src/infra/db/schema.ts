// Each domain module owns its table definitions; this barrel re-exports
// them so `import * as schema from "./schema.ts"` in db/connection.ts picks
// up everything Drizzle needs, while domain code imports directly from the
// appropriate module (e.g. `"../resource/schema.ts"`). Migration bookkeeping
// lives in the Drizzle-Kit-managed `__drizzle_migrations` table.
export * from "src/domain/auth/schema.ts"
export * from "src/domain/cat/schema.ts"
export * from "src/domain/char/schema.ts"
export * from "src/domain/col/schema.ts"
export * from "src/domain/comment/schema.ts"
export * from "src/domain/danmaku/schema.ts"
export * from "src/domain/doc/schema.ts"
export * from "src/domain/plugin/schema.ts"
export * from "src/domain/prefs/cacheSchema.ts"
export * from "src/domain/prefs/schema.ts"
export * from "src/domain/res/schema.ts"
export * from "src/domain/sync/schema.ts"
export * from "src/domain/tag/schema.ts"
export * from "src/domain/trace/schema.ts"
export * from "src/domain/trait/schema.ts"
export * from "src/domain/usage/schema.ts"
export * from "./runs-schema.ts"
