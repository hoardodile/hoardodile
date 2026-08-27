// Single side-effect import that brings every `FastifyInstance`
// augmentation (infra primitives + service container) into the type
// graph. Required for downstream packages that import `AppRouter`
// without the rest of the server tree.
import "src/infra/fastify-augment.ts"
import { authRouter } from "src/domain/auth/router.ts"
import { listSignIns } from "src/domain/auth/signins.ts"
import { buildBackupRouter } from "src/domain/backup/router.ts"
import { buildCategoryRouter } from "src/domain/cat/router.ts"
import { buildCharacterRouter } from "src/domain/char/router.ts"
import { buildResourceCollectionRouter } from "src/domain/col/router.ts"
import { buildCommentRouter } from "src/domain/comment/router.ts"
import { buildDanmakuRouter } from "src/domain/danmaku/router.ts"
import { buildDocumentRouter } from "src/domain/doc/router.ts"
import { buildMarketplaceRouter } from "src/domain/marketplace/router.ts"
import { buildPluginAssetRouter } from "src/domain/plugin/asset-router.ts"
import { buildPluginRouter } from "src/domain/plugin/router.ts"
import {
	buildAsyncPreferenceRouter,
	buildPluginPreferenceRouter,
	buildSystemPreferenceRouter,
} from "src/domain/prefs/router.ts"
import { buildImportRouter } from "src/domain/res/import-router.ts"
import { buildResourceRouter } from "src/domain/res/router.ts"
import { buildSearchRouter } from "src/domain/search/router.ts"
import { buildStorageRouter } from "src/domain/storage/router.ts"
import { buildSyncRouter } from "src/domain/sync/router.ts"
import { buildTagRouter } from "src/domain/tag/router.ts"
import { buildTraceRouter } from "src/domain/trace/router.ts"
import { buildTraitRouter } from "src/domain/trait/router.ts"
import { buildUsageRouter } from "src/domain/usage/router.ts"
import { buildVersionRouter } from "src/domain/version/router.ts"
import { z } from "zod"
import { authedProcedure, mergeRouters, router } from "./core.ts"
import type { AppRouterServices, RouterServices } from "./services.ts"

/**
 * Build the domain tRPC router: auth procedures at the root (`ping`, `me`)
 * plus namespaced domain modules (`resource.*`, `character.*`, ...) so
 * procedure names stay collision-free.
 *
 * Every sub-router is invoked explicitly here (not via
 * {@link FastifyInstance.domainRouters}) so TypeScript can preserve the
 * literal key names in `AppRouter`. Using `Record<string, AnyRouter>` 'even
 * indirectly through `Object.entries` 'causes tRPC's inference to fall back
 * to an index signature whose value type is `any`, which collapses every
 * sub-router into a single query procedure on the client side.
 */
export function buildDomainRouter(services: RouterServices) {
	return mergeRouters(
		authRouter,
		router({
			resource: mergeRouters(
				buildResourceRouter({
					service: services.resService,
					sessions: services.sessions,
				}),
				buildImportRouter({
					resService: services.resService,
					resUploads: services.resUploads,
					pluginLoader: services.pluginLoader,
					pluginHooks: services.pluginHooks,
					sessions: services.sessions,
					tmpBase: services.tmpBase,
				}),
			),
			character: buildCharacterRouter({
				service: services.charService,
				relationships: services.relationshipService,
			}),
			document: buildDocumentRouter({
				documents: services.docService,
			}),
			category: buildCategoryRouter(services.catService),
			tag: buildTagRouter(services.tagService),
			trait: buildTraitRouter(services.traitService),
			resCollection: buildResourceCollectionRouter(
				services.resCollectionService,
			),
			comment: buildCommentRouter(services.commentService),
			danmaku: buildDanmakuRouter(services.danmakuService),
			usage: buildUsageRouter(services.usageService),
			storage: buildStorageRouter({ service: services.storageService }),
			sync: buildSyncRouter(services.syncService),
			trace: buildTraceRouter(services.traceService),
			search: buildSearchRouter(services.searchService),
			plugin: buildPluginRouter({
				service: services.pluginService,
				prefs: services.pluginPrefService,
				cache: services.cacheService,
				sessions: services.sessions,
				usage: {
					countByContentPluginId: (pluginId) =>
						services.resService.countByContentPluginId(pluginId),
				},
				cleanupPluginData: (pluginId) => {
					services.pluginPrefService.removeAllByPlugin(pluginId)
					services.cacheService.removeAllByPlugin(pluginId)
				},
			}),
			pluginAsset: buildPluginAssetRouter({
				service: services.pluginAssetService,
				consent: services.pluginAssetConsent,
			}),
			marketplace: buildMarketplaceRouter({
				service: services.marketplaceService,
			}),
			systemPreference: buildSystemPreferenceRouter(services.systemPrefService),
			asyncPreference: buildAsyncPreferenceRouter(services.asyncPrefService),
			pluginPreference: buildPluginPreferenceRouter(
				services.pluginPrefService,
				services.cacheService,
			),
			access: router({
				/**
				 * Newest sign-in events (ip, origin, device label,
				 * recordedAt). Rows are login events — sessions are
				 * stateless cookies and every login rotates to a fresh
				 * session id.
				 */
				connections: authedProcedure.query(({ ctx }) => ({
					connections: listSignIns(ctx.req.server.db),
				})),
			}),
			network: router({
				/** Read-only view of the resolved outbound proxy config. */
				info: authedProcedure.query(() => services.outboundNetwork.info()),
				/** User-triggered connectivity probe towards the raw GitHub host. */
				test: authedProcedure.query(() => services.outboundNetwork.test()),
			}),
			diagnostics: router({
				/**
				 * Best-effort ingestion of frontend console / window / React
				 * errors into the server's own pino log files. The SPA and the
				 * server share the origin, so nothing leaves the machine — the
				 * user-facing export stays Settings → About → "Copy
				 * diagnostics"; this procedure simply makes the frontend side
				 * of a report visible in the same `app.log`.
				 */
				clientLog: authedProcedure
					.input(
						z.object({
							entries: z
								.array(
									z.object({
										ts: z.number().int().positive(),
										level: z.enum(["error", "warn"]),
										message: z.string().min(1).max(1000),
										stack: z.string().max(4000).optional(),
									}),
								)
								.min(1)
								.max(50),
						}),
					)
					.mutation(({ ctx, input }) => {
						for (const entry of input.entries) {
							const log = ctx.req.log
							log[entry.level](
								{
									src: "client",
									clientTs: entry.ts,
									...(entry.stack !== undefined ? { stack: entry.stack } : {}),
								},
								entry.message,
							)
						}
					}),
			}),
		}),
	)
}

/**
 * Compose the full application router by merging the domain router with
 * infrastructure sub-routers. Infra services (backup service, signal
 * emitter) are likewise read off the services record, so there is a single
 * source of truth for wiring.
 */
export function buildAppRouter(services: AppRouterServices) {
	return mergeRouters(
		buildDomainRouter(services),
		router({
			backup: buildBackupRouter({
				service: services.backupService,
				signals: services.signals,
			}),
			version: buildVersionRouter({
				service: services.versionService,
				signals: services.signals,
			}),
		}),
	)
}

export type AppRouter = ReturnType<typeof buildAppRouter>
