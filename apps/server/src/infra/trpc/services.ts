import type { PluginHooks, PluginLoader } from "@hoardodile/host"
import type { SessionStore } from "src/domain/auth/session.ts"
import type { BackupService } from "src/domain/backup/service.ts"
import type { CatService } from "src/domain/cat/service.ts"
import type { RelationshipService } from "src/domain/char/relationship_service.ts"
import type { CharService } from "src/domain/char/service.ts"
import type { ResCollectionService } from "src/domain/col/service.ts"
import type { CommentService } from "src/domain/comment/service.ts"
import type { DanmakuService } from "src/domain/danmaku/service.ts"
import type { DocService } from "src/domain/doc/service.ts"
import type { MarketplaceService } from "src/domain/marketplace/service.ts"
import type { PluginAssetService } from "src/domain/plugin/asset-service.ts"
import type { ConsentBroker } from "src/domain/plugin/consent.ts"
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
import type { OutboundNetwork } from "src/infra/outbound-network.ts"
import type { SignalEmitter } from "src/infra/signals.ts"
import type { ThumbService } from "src/infra/thumb/service.ts"

/**
 * Narrow interface containing only the domain services that tRPC routers
 * need. Used by {@link buildDomainRouter} so sub-routers do not depend on
 * the full {@link FastifyInstance} augmentation.
 */
export interface RouterServices {
	readonly resService: ResService
	readonly resUploads: ResUploads
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
	readonly pluginService: PluginService
	readonly pluginLoader: PluginLoader
	readonly pluginHooks: PluginHooks
	readonly pluginAssetService: PluginAssetService
	readonly pluginAssetConsent: ConsentBroker
	readonly marketplaceService: MarketplaceService
	readonly outboundNetwork: OutboundNetwork
	readonly sessions: SessionStore
	/**
	 * Absolute path to the local temp directory (`<storageRoot>/local/cache/tmp`).
	 * Used by folder-import procedures to create extraction directories for
	 * uploaded zip archives.
	 */
	readonly tmpBase: string
}

/**
 * Extends {@link RouterServices} with the infrastructure services needed
 * by {@link buildAppRouter} (backup, version, thumbs, signals).
 */
export interface AppRouterServices extends RouterServices {
	readonly backupService: BackupService
	readonly versionService: VersionService
	readonly thumbService: ThumbService
	readonly signals: SignalEmitter
}
