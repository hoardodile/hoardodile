import type { PluginHooks, PluginLoader } from "@hoardodile/host"
import type { Env } from "src/config/env.ts"
import type { SessionStore } from "src/domain/auth/session.ts"
import type { BackupService } from "src/domain/backup/service.ts"
import type { CatService } from "src/domain/cat/service.ts"
import type { RelationshipService } from "src/domain/char/relationship_service.ts"
import type { CharService } from "src/domain/char/service.ts"
import type { ResCollectionService } from "src/domain/col/service.ts"
import type { CommentService } from "src/domain/comment/service.ts"
import type { DanmakuService } from "src/domain/danmaku/service.ts"
import type { DocService } from "src/domain/doc/service.ts"
import type { PluginService } from "src/domain/plugin/service.ts"
import type {
	AsyncPrefService,
	CacheService,
	PluginPrefService,
	SystemPrefService,
} from "src/domain/prefs/service.ts"
import type { ResService } from "src/domain/res/service.ts"
import type { ResUploads } from "src/domain/res/upload.ts"
import type { SearchService } from "src/domain/search/service.ts"
import type { StorageService } from "src/domain/storage/service.ts"
import type { SyncService } from "src/domain/sync/service.ts"
import type { TagService } from "src/domain/tag/service.ts"
import type { TraceService } from "src/domain/trace/service.ts"
import type { TraitService } from "src/domain/trait/service.ts"
import type { UsageService } from "src/domain/usage/service.ts"
import type { VersionService } from "src/domain/version/service.ts"
import type { DbHandles, SqliteDb } from "src/infra/db/connection.ts"
import type { SseBroadcaster } from "src/infra/http/sse-broadcaster.ts"
import type { Deferred, RuntimeRefs } from "src/infra/runtime-context.ts"
import type { SignalEmitter } from "src/infra/signals.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"
import type { ThumbService } from "src/infra/thumb/service.ts"

/**
 * Single source of truth for the {@link FastifyInstance} type surface.
 *
 * Centralising the Fastify augmentation here lets every consumer reach
 * the full surface with `import "src/infra/fastify-augment.ts"` (or
 * transitively via `src/domain/index.ts`).
 *
 * Decorations split into two layers:
 *
 * 1. **Infrastructure primitives** — env, db, paths, sessions, signals,
 *    readOnly. Owned by Fastify plugins in `src/infra/plugins.ts`. These
 *    are genuinely transport concerns: lifecycle, configuration,
 *    request-scoped helpers.
 * 2. **Service container** — the closure-based domain services. Owned
 *    by domain plugins via `buildServicePlugin`. These are pure DI
 *    targets, exposed on the Fastify instance only because tRPC and
 *    HTTP handlers run inside the Fastify request scope.
 */
declare module "fastify" {
	interface FastifyContextConfig {
		/**
		 * When true, the route is declared safe to use while the server is
		 * viewing a read-only archive. The protected HTTP plugin defaults every
		 * unmarked route to 403 in read-only mode.
		 */
		readOnlySafe?: boolean
	}

	interface FastifyInstance {
		// Infrastructure primitives
		readonly env: Env
		readonly dbHandles: DbHandles
		readonly db: SqliteDb
		readonly paths: StoragePaths
		readonly signals: SignalEmitter
		readonly sseBroadcaster: SseBroadcaster
		readonly sessions: SessionStore
		/**
		 * True when the server is viewing a past archive version. The DB
		 * is open against a read-only clone; mutation procedures must
		 * short-circuit with `FORBIDDEN`.
		 */
		readonly readOnly: boolean

		// Internal runtime state used for in-process storage context reloads.
		// These are owned by {@link buildServer} and should not be accessed
		// outside of the server lifecycle helpers.
		readonly runtimeRefs: RuntimeRefs
		isDraining: boolean
		inflightRequests: number
		reloadGate: Deferred<void> | undefined

		// Domain services
		readonly resService: ResService
		readonly resUploads: ResUploads
		/** Wired by thumb-plugin after upload commit to warm cover thumbs. */
		readonly registerUploadWarmCover: (fn: (id: string) => void) => void
		readonly charService: CharService
		readonly relationshipService: RelationshipService
		readonly docService: DocService
		readonly searchService: SearchService
		readonly catService: CatService
		readonly tagService: TagService
		readonly traitService: TraitService
		readonly resCollectionService: ResCollectionService
		readonly commentService: CommentService
		readonly danmakuService: DanmakuService
		readonly usageService: UsageService
		readonly storageService: StorageService
		readonly syncService: SyncService
		readonly traceService: TraceService
		readonly systemPrefService: SystemPrefService
		readonly asyncPrefService: AsyncPrefService
		readonly pluginPrefService: PluginPrefService
		readonly cacheService: CacheService

		// Cross-cutting infra services that build on top of one or more domain services
		readonly thumbService: ThumbService
		readonly backupService: BackupService
		readonly versionService: VersionService
		readonly pluginLoader: PluginLoader
		readonly pluginService: PluginService
		readonly pluginHooks: PluginHooks
	}
}
