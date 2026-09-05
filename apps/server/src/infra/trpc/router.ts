// Single side-effect import that brings every `FastifyInstance`
// augmentation (infra primitives + service container) into the type
// graph. Required for downstream packages that import `AppRouter`
// without the rest of the server tree.
import "src/infra/fastify-augment.ts"
import { readdirSync, readFileSync, statSync } from "node:fs"
import { join } from "node:path"
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
import { buildProtectionRouter } from "src/domain/protection/router.ts"
import { buildReplicationRouter } from "src/domain/replication/router.ts"
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
					connections: listSignIns(ctx.req.server.hostDb ?? ctx.req.server.db),
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
				 * user-facing export stays Settings → About → Download logs;
				 * this procedure simply makes the frontend side of a report
				 * visible in the same `app.log`.
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
				/**
				 * The server's own rolling log files, redacted before they
				 * leave the host: pino already masks cookies/authorization/
				 * passwords; this endpoint additionally replaces the storage
				 * root path and private IPv4 addresses, so a log archive the
				 * user attaches to a public issue does not leak the library
				 * location or LAN topology.
				 */
				logs: authedProcedure.query(({ ctx }) => ({
					files: readRollingLogs(
						ctx.req.server.paths.local.logs(),
						ctx.req.server.paths.root,
					),
				})),
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
		router({ protection: buildProtectionRouter(services.protectionService) }),
		router({
			replication: buildReplicationRouter(
				services.replicationService,
				services.protectionService,
			),
		}),
		buildDomainRouter(services),
		router({
			backup: buildBackupRouter({
				service: services.backupService,
				legacyReadOnly: services.protectionService !== undefined,
				signals: services.signals,
			}),
			version: buildVersionRouter({
				service: services.versionService,
				reload: services.reloadStorage,
				signals: services.signals,
			}),
		}),
	)
}

export type AppRouter = ReturnType<typeof buildAppRouter>

// ── Server log archive (diagnostics.logs) ────────────────────────────────────

/** `app.log` / `app.error.log` plus the pino-roll dated variants. */
const LOG_FILE_RE = /^app(\.error)?(\.\d{4}-\d{2}-\d{2}(\.\d+)?)?\.log$/

/** Private (RFC 1918) IPv4 addresses — never send LAN topology into an issue. */
const PRIVATE_IP_RE =
	/\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3})\b/g

const MAX_LOG_FILES = 12
const MAX_LOG_FILE_BYTES = 1024 * 1024
const MAX_LOG_TOTAL_BYTES = 4 * 1024 * 1024

function redactLogContent(content: string, storageRoot: string): string {
	let text = content.split(storageRoot).join("<storage>")
	text = text.split(storageRoot.replaceAll("\\", "/")).join("<storage>")
	return text.replace(PRIVATE_IP_RE, "<ip>")
}

/**
 * Read the most recent rolling log files (chronological order) with
 * sensible caps, redacting the storage root and private IPs so the
 * archive is safe to attach to a public issue.
 */
export function readRollingLogs(
	logsDir: string,
	storageRoot: string,
): Array<{ readonly name: string; readonly content: string }> {
	const names = readdirSync(logsDir)
		.filter((name) => LOG_FILE_RE.test(name))
		.sort()
	const selected = names.slice(-MAX_LOG_FILES)
	const files: Array<{ readonly name: string; readonly content: string }> = []
	let totalBytes = 0
	for (const name of selected) {
		const path = join(logsDir, name)
		let size: number
		try {
			size = statSync(path).size
		} catch {
			continue
		}
		if (size <= 0) continue
		if (size > MAX_LOG_FILE_BYTES) {
			// Keep the tail — the most recent evidence.
			size = MAX_LOG_FILE_BYTES
		}
		if (totalBytes + size > MAX_LOG_TOTAL_BYTES) continue
		try {
			const content = readFileSync(path, "utf8")
			files.push({ name, content: redactLogContent(content, storageRoot) })
			totalBytes += size
		} catch {
			// A log rotated away mid-read: skip it.
		}
	}
	return files
}
