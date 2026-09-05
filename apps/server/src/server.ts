import { existsSync, statSync } from "node:fs"
import { join } from "node:path"
import { setTimeout } from "node:timers/promises"
import cookie from "@fastify/cookie"
import cors from "@fastify/cors"
import { inspectManagedProcesses } from "@hoardodile/backup"
import {
	currentVersion,
	recoverVersionPublication,
	withStorageRequest,
} from "@hoardodile/host/hoard"
import { fastifyTRPCPlugin } from "@trpc/server/adapters/fastify"
import Fastify, {
	type FastifyError,
	type FastifyInstance,
	type FastifyReply,
	type FastifyRequest,
	LogController,
} from "fastify"
import type { Env } from "src/config/env.ts"
import { buildLoggerOptions } from "src/config/logger.ts"
import {
	deleteAuthRow,
	getAuthRow,
	type StoredAuthRow,
	setAuthRow,
} from "src/domain/auth/repo.ts"
import { registerAuthRoutes } from "src/domain/auth/routes.ts"
import type { SessionStore } from "src/domain/auth/session.ts"
import { backupPlugin } from "src/domain/backup/plugin.ts"
import type { BackupService } from "src/domain/backup/service.ts"
import { applyPendingRestore } from "src/domain/backup/startup.ts"
import { domainPlugins } from "src/domain/index.ts"
import { registerProtection } from "src/domain/protection/plugin.ts"
import { protectionDirectory } from "src/domain/protection/service.ts"
import { registerReplication } from "src/domain/replication/plugin.ts"
import { cleanupOrphanResourceFolders } from "src/domain/res/files.ts"
import { cleanupTmpDir } from "src/domain/res/folder-import.ts"
import {
	hasPreRewriteTagSchema,
	runPreMigrationTagDedupe,
	runTagDedupe,
} from "src/domain/tag/dedupe.ts"
import { versionPlugin } from "src/domain/version/plugin.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { openHostDatabase } from "src/infra/db/host.ts"
import { authConfiguredPlugin } from "src/infra/http/auth-configured.ts"
import { sendFile } from "src/infra/http/conditional-request.ts"
import { toSafeErrorBody } from "src/infra/http/error-response.ts"
import { healthPlugin } from "src/infra/http/health.ts"
import { protectedHttpPlugin } from "src/infra/http/plugin.ts"
import { pluginRenderPlugin } from "src/infra/http/plugin-render.ts"
import { sharedFolderPlugin } from "src/infra/http/shared-folder.ts"
import { shutdownPlugin } from "src/infra/http/shutdown.ts"
import {
	dbPlugin,
	envPlugin,
	pathsPlugin,
	sessionsPlugin,
	signalsPlugin,
	sseBroadcasterPlugin,
} from "src/infra/plugins.ts"
import {
	createDeferred,
	createRuntimeRefs,
	type Deferred,
	type RuntimeRefs,
} from "src/infra/runtime-context.ts"
import { resolveStorageContext } from "src/infra/storage/bootstrap.ts"
import { recoverCheckpointPublication } from "src/infra/storage/checkpoint.ts"
import { acquireStorageInstance } from "src/infra/storage/instance-lock.ts"
import {
	createStoragePaths,
	type StoragePaths,
} from "src/infra/storage/paths.ts"
import { thumbPlugin } from "src/infra/thumb/plugin.ts"
import type { ThumbService } from "src/infra/thumb/service.ts"
import { makeCreateContext } from "src/infra/trpc/context.ts"
import { runWithDeviceContext } from "src/infra/trpc/device-context.ts"
import { buildAppRouter } from "src/infra/trpc/router.ts"

export type BuildServerOptions = {
	readonly env: Env
	readonly dbHandles?: DbHandles
	/**
	 * Pre-built {@link StoragePaths}. When omitted, one is constructed from
	 * `env.STORAGE_ROOT` via {@link resolveStorageContext} (default version
	 * resolution). Tests that care about on-disk effects pass their own so
	 * the per-test tmpdir gets cleaned up with the rest of the test.
	 */
	readonly storagePaths?: StoragePaths
	/**
	 * Resolved DB file path. When omitted the same
	 * {@link resolveStorageContext} call provides it. The standard caller
	 * ({@link launchHttpServer}) passes both this and `storagePaths`
	 * already-derived from version state.
	 */
	readonly databaseUrl?: string
	/**
	 * When true, every tRPC mutation procedure short-circuits with a
	 * `FORBIDDEN` error. Used when the user is viewing a past version --
	 * the DB is open against a read-only clone in that case.
	 */
	readonly readOnly?: boolean
	readonly enableRequestLogging?: boolean
	/**
	 * Hook invoked after the server has hot-reloaded its storage context
	 * in-process (backup restore or version switch). Callers can update
	 * their own UI state; the server did not restart.
	 */
	readonly onContextReloaded?: () => void
	/**
	 * Absolute path to a directory of pre-built web assets. When set,
	 * Fastify serves them at `/` so clients can load the app from
	 * `http://127.0.0.1:PORT/` -- keeping `SameSite=Strict` cookies
	 * working without any custom protocol. In dev the Vite dev server is
	 * used instead and this option is left unset.
	 */
	readonly webRoot?: string
	/**
	 * Invoked after an authorized `POST /api/internal/shutdown`. Defaults
	 * to Fastify `close()` then `process.exit(0)`. Tests intercept this
	 * so the Vitest process does not exit.
	 */
	readonly onAuthorizedShutdown?: () => void | Promise<void>
	/**
	 * Override the iron-session seal password. When omitted, a per-host
	 * key is loaded (or generated) at `paths.local.sessionKey()`. Tests
	 * pass an inline 32+ char value to avoid touching disk.
	 */
	readonly sessionPassword?: string
}

export type StorageReloadResult = {
	readonly storagePaths: StoragePaths
	readonly dbFilePath: string
	readonly readOnly: boolean
	readonly latestVersion: number
	readonly activeVersion: number
}

export type BuiltServer = {
	readonly app: FastifyInstance
	readonly db: DbHandles
	readonly sessions: SessionStore
	readonly storagePaths: StoragePaths
	readonly thumbs: ThumbService
	/**
	 * Backup service exposed for callers that need to invoke backup/restore
	 * operations directly without going through the HTTP / tRPC auth surface.
	 */
	readonly backups: BackupService
	readonly close: () => Promise<void>
}

/**
 * Build a configured Fastify instance with DB, auth, and tRPC wired in.
 *
 * `buildServer` is the single composition root: it owns the order in
 * which infrastructure, domain, HTTP and tRPC plugins are registered.
 * The actual wiring is delegated to small helpers below so each phase
 * has a single responsibility and is independently auditable.
 *
 * Callers who already own a {@link DbHandles} (e.g. tests) pass it via
 * `opts.dbHandles` so the lifecycle stays with them; otherwise the server
 * owns its own DB and closes it on shutdown.
 */
export async function buildServer(
	opts: BuildServerOptions,
): Promise<BuiltServer> {
	const root = opts.storagePaths?.root ?? opts.env.STORAGE_ROOT
	const release =
		opts.env.DATABASE_URL !== ":memory:" &&
		opts.dbHandles?.filePath !== ":memory:"
			? acquireStorageInstance(root)
			: undefined
	const resources: { app?: FastifyInstance; database?: DbHandles } = {}
	try {
		return await buildServerWithStorageLock(opts, release, resources)
	} catch (error) {
		await resources.app?.close().catch(() => {})
		try {
			resources.database?.close()
		} catch {
			/* Initialization may have already closed the handle. */
		}
		release?.()
		throw error
	}
}

async function buildServerWithStorageLock(
	opts: BuildServerOptions,
	release: (() => void) | undefined,
	resources: { app?: FastifyInstance; database?: DbHandles },
): Promise<BuiltServer> {
	const storageRoot = opts.storagePaths?.root ?? opts.env.STORAGE_ROOT
	const pendingRestore = existsSync(
		join(protectionDirectory(storageRoot), "maintenance.json"),
	)
	const processes = await inspectManagedProcesses(
		join(protectionDirectory(storageRoot), "processes"),
	)
	const nativeProcessesBusy = processes.active + processes.uncertain > 0
	const suspended = pendingRestore || nativeProcessesBusy
	if (!suspended) {
		await recoverVersionPublication(storageRoot)
		await recoverCheckpointPublication(storageRoot)
	}
	const version = currentVersion(storageRoot) || 1
	const bootstrap = suspended
		? {
				storagePaths: createStoragePaths({
					root: storageRoot,
					activeVersion: version,
					latestVersion: version,
				}),
				databaseUrl: ":memory:",
				readOnly: true,
			}
		: resolveBootstrapForBuild(opts)
	// Apply any pending restore BEFORE opening the DB -- the swap is a
	// file-level rename of the live DB, so no handle may be held yet.
	if (!opts.dbHandles && !suspended) {
		applyPendingRestorePreservingAuth(bootstrap.storagePaths)
	}

	const app = createFastifyApp(
		opts.env,
		bootstrap.storagePaths,
		opts.enableRequestLogging,
	)
	resources.app = app
	if (release) app.addHook("onClose", async () => release())

	const dbHandles = suspended
		? openDb(":memory:")
		: (opts.dbHandles ??
			openDb(bootstrap.databaseUrl, { readonly: bootstrap.readOnly }))
	if (suspended) dbHandles.runMigrations()
	const ownsDbHandles = opts.dbHandles === undefined
	if (ownsDbHandles) resources.database = dbHandles
	if (ownsDbHandles && !bootstrap.readOnly) {
		migrateWithDedupe(dbHandles, opts.env, app.log)
	}
	let hostHandles: DbHandles | undefined
	if (
		opts.env.DATABASE_URL !== ":memory:" &&
		opts.dbHandles?.filePath !== ":memory:"
	) {
		if (bootstrap.readOnly && !suspended) {
			const latest = openDb(join(storageRoot, "app.sqlite"))
			try {
				latest.runMigrations()
				hostHandles = openHostDatabase(storageRoot, latest.db)
			} finally {
				latest.close()
			}
		} else
			hostHandles = openHostDatabase(
				storageRoot,
				suspended ? undefined : dbHandles.db,
			)
	}
	app.decorate("hostDb", hostHandles?.db ?? dbHandles.db)
	if (hostHandles) app.addHook("onClose", async () => hostHandles.close())

	const runtimeRefs = createRuntimeRefs({
		dbHandles,
		storagePaths: bootstrap.storagePaths,
		readOnly: bootstrap.readOnly,
	})
	// Expose refs on the instance so reload helpers can mutate them.
	app.decorate("runtimeRefs", runtimeRefs)
	app.decorate("isDraining", false)
	app.decorate("inflightRequests", 0)
	app.decorate("reloadGate", undefined as Deferred<void> | undefined)
	app.decorate("storageReloadHandlers", [])
	app.decorate("activeStorageRequests", new Set<FastifyRequest>())
	app.decorate("pendingStorageReloads", 0)
	app.decorate("libraryMaintenance", suspended)
	app.decorate("nativeProcessesBusy", nativeProcessesBusy)

	await registerInfrastructure(app, opts, runtimeRefs, ownsDbHandles)
	await registerDomainAndInfraServices(app)
	await registerProtection(app, () => reloadStorageContext(app))
	await registerReplication(app)
	// Fire-and-forget: clear local/cache/tmp and local/.tmp (which contains the
	// global upload staging pool) on startup. Any active uploads /
	// extractions were interrupted by the restart anyway; orphaned staged
	// files are reclaimed here.
	cleanupTmpDir(app.paths.local.tmp()).catch(() => {})
	cleanupTmpDir(app.paths.local.uploadStagingRoot()).catch(() => {})
	// Fire-and-forget: reclaim resource folders left behind when a hard-delete
	// raced an open file handle (EPERM/EBUSY on Windows).
	cleanupOrphanResourceFolders(app.paths, app.db).catch(() => {})
	await registerHttpSurface(app, {
		onAuthorizedShutdown: opts.onAuthorizedShutdown,
	})
	await registerTrpcSurface(app)
	await registerStaticAssets(app, opts.webRoot)

	installDrainingMiddleware(app)
	subscribeContextReload(app, opts.onContextReloaded ?? defaultContextReloaded)

	// Sanitize the client-facing error body: internal messages (which can
	// carry absolute filesystem paths) and error codes must never leak over
	// HTTP. Fastify still logs the full error server-side.
	app.setErrorHandler((error: FastifyError, _req, reply) => {
		return reply.status(error.statusCode ?? 500).send(toSafeErrorBody(error))
	})

	return buildResult(app)
}

function resolveBootstrapForBuild(opts: BuildServerOptions): {
	readonly storagePaths: StoragePaths
	readonly databaseUrl: string
	readonly readOnly: boolean
} {
	const readOnly = opts.readOnly === true
	if (opts.dbHandles !== undefined) {
		const storagePaths =
			opts.storagePaths ??
			createStoragePaths({
				root: opts.env.STORAGE_ROOT,
				activeVersion: 1,
				latestVersion: 1,
			})
		return {
			storagePaths,
			databaseUrl: opts.databaseUrl ?? storagePaths.runtimeDb(),
			readOnly,
		}
	}

	if (opts.storagePaths !== undefined && opts.databaseUrl !== undefined) {
		return {
			storagePaths: opts.storagePaths,
			databaseUrl: opts.databaseUrl,
			readOnly,
		}
	}
	if (opts.storagePaths !== undefined) {
		// Caller provided paths but not a DB URL; fall back to the version
		// resolved on those paths.
		return {
			storagePaths: opts.storagePaths,
			databaseUrl: opts.storagePaths.runtimeDb(),
			readOnly,
		}
	}
	if (opts.env.DATABASE_URL === ":memory:") {
		return {
			storagePaths: createStoragePaths({
				root: opts.env.STORAGE_ROOT,
				activeVersion: 1,
				latestVersion: 1,
			}),
			databaseUrl: ":memory:",
			readOnly: false,
		}
	}
	const ctx = resolveStorageContext(opts.env)
	return {
		storagePaths: ctx.paths,
		databaseUrl: ctx.dbFilePath,
		readOnly: ctx.readOnly,
	}
}

/**
 * Apply pending migrations and the tag/namespace dedupe in the right
 * order. The migration runner applies ALL pending migrations at once, and
 * the unique-name indexes would fail to create on legacy data with
 * duplicate names — so databases that predate the rule tables get a
 * pre-migration dedupe pass first. The post-migration pass then records
 * the verified state (a no-op on upgraded and fresh databases alike).
 */
function migrateWithDedupe(
	dbHandles: DbHandles,
	env: Env,
	log: FastifyInstance["log"],
): void {
	const options = {
		dryRun: env.TAG_DEDUPE_DRY_RUN,
		log: (msg: string, details?: Readonly<Record<string, unknown>>) =>
			log.info({ ...details }, msg),
	}
	if (hasPreRewriteTagSchema(dbHandles.db)) {
		runPreMigrationTagDedupe(dbHandles.db, options)
	}
	dbHandles.runMigrations()
	const dedupe = runTagDedupe(dbHandles.db, options)
	if (!dedupe.skipped) {
		log.info({ ...dedupe }, "tag-dedupe.run")
	}
}

/** Register env, DB, paths, signals, sessions, and probe infrastructure. */
async function registerInfrastructure(
	app: FastifyInstance,
	opts: BuildServerOptions,
	runtimeRefs: RuntimeRefs,
	ownsDbHandles: boolean,
): Promise<void> {
	const { env } = opts
	await app.register(envPlugin, { env })
	await app.register(dbPlugin, {
		runtimeRefs,
		ownsDbHandles,
	})
	await app.register(pathsPlugin, { runtimeRefs })
	await app.register(signalsPlugin)
	await app.register(sseBroadcasterPlugin)
	await app.register(sessionsPlugin, {
		password: opts.sessionPassword,
	})
}

function createFastifyApp(
	env: Env,
	storagePaths?: StoragePaths,
	enableRequestLogging?: boolean,
): FastifyInstance {
	const silent = env.NODE_ENV === "test" || env.LOG_LEVEL === "silent"
	return Fastify({
		logger: silent
			? false
			: buildLoggerOptions({
					level: env.LOG_LEVEL,
					nodeEnv: env.NODE_ENV,
					logsDir: storagePaths?.local.logs(),
				}),
		logController: new LogController({
			disableRequestLogging: silent || enableRequestLogging === false,
		}),
		// Clients may go idle for minutes between interactions (e.g. reading
		// a resource on another screen). The Node.js default of 5 s forces a
		// fresh TCP handshake on every burst of activity, which amplifies the
		// impact of transient WiFi/NAT dropouts. Keep connections alive for
		// 2 minutes so idle sessions reuse the same socket.
		keepAliveTimeout: 120_000,
		// Node's `server.close()` only reaps sockets Node already tracks as
		// idle, and clients that read their responses fully (browsers,
		// undici) may still have a keep-alive socket in the half-open window
		// — with the 2-minute `keepAliveTimeout` a graceful shutdown would
		// stall on it. Close all connections at shutdown; in-flight requests
		// are dropped but SQLite/WAL keeps the data durable.
		forceCloseConnections: true,
		// tRPC's `httpBatchLink` joins every batched procedure name into a
		// single URL segment (`/trpc/a.x,b.y,c.z,...`). Fastify's default
		// `maxParamLength` of 100 silently 404s once the segment grows
		// beyond that, which manifests as missing data on screens that
		// fetch many namespaces at once. Bump it to comfortably fit any
		// realistic batch.
		routerOptions: {
			maxParamLength: 2048,
		},
		// Boot loads the content plugins (`content-plugin-domain`): those
		// installed on disk plus any SEED_PLUGIN_PATHS / DEV_PLUGIN_PATHS
		// directories, each `main.js` imported in a sandboxed worker.
		// Antivirus scans or slow/synced storage can stretch that past
		// avvio's 10 s default `pluginTimeout`, which then aborts an
		// otherwise healthy boot with "Plugin did not start in time".
		// Give slow machines ample headroom.
		pluginTimeout: 120_000,
	})
}

/** Register domain services plus thumbs, backup, and version infrastructure. */
async function registerDomainAndInfraServices(
	app: FastifyInstance,
): Promise<void> {
	await app.register(domainPlugins)
	await app.register(thumbPlugin)
	await app.register(versionPlugin)
	await app.register(backupPlugin)
}

/** Register the HTTP routes and the protected HTTP scope. */
async function registerHttpSurface(
	app: FastifyInstance,
	opts: {
		readonly onAuthorizedShutdown?: () => void | Promise<void>
	},
): Promise<void> {
	// Plugin iframes are sandboxed without allow-same-origin (opaque origin
	// "null"). All requests from them are cross-origin, so allow any origin.
	await app.register(cors, {
		origin: "*",
		methods: ["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"],
	})

	await app.register(cookie)

	app.get("/health", async () => ({ ok: true as const }))
	app.get("/api/protection/state", async (_request, reply) => {
		reply.header("Cache-Control", "no-store")
		const status = app.protectionService.getStatus()
		return {
			maintenance:
				app.libraryMaintenance ||
				Boolean(status.maintenance || status.maintenanceError),
		}
	})

	await registerAuthRoutes(app, {
		env: app.env,
		db: app.hostDb,
		preferencesDb: app.db,
		sessions: app.sessions,
	})

	// Plugin assets are served outside the auth scope because sandboxed
	// plugin iframes have an opaque origin ("null"). Cross-origin requests
	// from "null" do not send SameSite=Strict cookies, so auth would fail.
	await app.register(pluginRenderPlugin)

	// All session-gated HTTP routes (uploads, downloads, thumbs, SSE) live
	// inside this encapsulated scope. Auth is enforced by the plugin's own
	// `preHandler`; tRPC and `/auth/*` are intentionally outside.
	await app.register(protectedHttpPlugin)

	// Health probe for external monitoring — intentionally unauthenticated
	// and outside the session scope.
	await app.register(healthPlugin)

	// Desktop sidecar graceful stop. Token-gated; 401 when the env token
	// is unset (self-host) or the request does not match.
	await app.register(shutdownPlugin, {
		onAuthorized: opts.onAuthorizedShutdown,
	})
	await app.register(sharedFolderPlugin)
	await app.register(authConfiguredPlugin)
}

/** Register the tRPC router and request context factory. */
async function registerTrpcSurface(app: FastifyInstance): Promise<void> {
	const appRouter = buildAppRouter({
		resService: app.resService,
		resUploads: app.resUploads,
		charService: app.charService,
		relationshipService: app.relationshipService,
		docService: app.docService,
		searchService: app.searchService,
		catService: app.catService,
		tagService: app.tagService,
		traitService: app.traitService,
		resCollectionService: app.resCollectionService,
		commentService: app.commentService,
		danmakuService: app.danmakuService,
		usageService: app.usageService,
		storageService: app.storageService,
		syncService: app.syncService,
		traceService: app.traceService,
		systemPrefService: app.systemPrefService,
		asyncPrefService: app.asyncPrefService,
		pluginPrefService: app.pluginPrefService,
		cacheService: app.cacheService,
		pluginService: app.pluginService,
		pluginLoader: app.pluginLoader,
		pluginHooks: app.pluginHooks,
		pluginAssetService: app.pluginAssetService,
		pluginAssetConsent: app.pluginAssetConsent,
		marketplaceService: app.marketplaceService,
		outboundNetwork: app.outboundNetwork,
		backupService: app.backupService,
		protectionService: app.protectionService,
		reloadStorage: () => reloadStorageContext(app).then(() => undefined),
		replicationService: app.replicationService,
		versionService: app.versionService,
		thumbService: app.thumbService,
		signals: app.signals,
		sessions: app.sessions,
		tmpBase: app.paths.local.tmp(),
	})
	const createContext = makeCreateContext({
		env: app.env,
		db: app.db,
		sessions: app.sessions,
	})
	// Capture the client's platform from the request header for the whole
	// request chain; trace.record() reads it when writing a footprint.
	app.addHook("onRequest", (req, _reply, done) => {
		runWithDeviceContext(req, done)
	})
	await app.register(fastifyTRPCPlugin, {
		prefix: "/trpc",
		trpcOptions: { router: appRouter, createContext },
	})
}

/**
 * Serve a clean, path-leaking-free 503 for the SPA shell when the mounted
 * web root has no `index.html` (a missing or stale build). The sidecar must
 * never surface a raw `ENOENT` 500 with the absolute filesystem path to LAN
 * clients. The copy is deliberately generic — the server has no i18n.
 */
function sendSpaUnavailable(reply: FastifyReply): FastifyReply {
	reply.code(503)
	reply.header("content-type", "text/html; charset=utf-8")
	reply.header("content-security-policy", "frame-ancestors 'self'")
	reply.header("cache-control", "no-cache")
	reply.send(
		'<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Service Unavailable</title></head><body><h1>Service Unavailable</h1><p>The app&#39;s web UI is not built or is temporarily unavailable. Rebuild the SPA or reinstall the desktop app, then reload this page.</p></body></html>',
	)
	return reply
}

/**
 * True when `path` names a regular file. Unlike a bare `existsSync`, a
 * directory (or a path we cannot stat) is treated as unavailable so a
 * broken build degrades cleanly instead of streaming a directory (EISDIR).
 */
function isRegularFile(path: string): boolean {
	try {
		return statSync(path).isFile()
	} catch {
		return false
	}
}

/** Serve bundled web assets. */
async function registerStaticAssets(
	app: FastifyInstance,
	webRoot: string | undefined,
): Promise<void> {
	// The SPA surface is registered even when no web root is mounted, so a
	// missing/stale build always degrades to a single clean 503 (never a mix
	// of 404 for "no mount" and 500 for a `stat` ENOENT). Static file serving
	// (@fastify/static) is only registered when a web root is available.
	const mountedRoot = webRoot !== undefined ? webRoot : null

	// Absolute `index.html` path when the build is actually served, or
	// `undefined` when there is no mount or the SPA build is absent.
	const spaIndexPath = (): string | undefined => {
		if (mountedRoot === null) return undefined
		const html = join(mountedRoot, "index.html")
		return isRegularFile(html) ? html : undefined
	}

	if (mountedRoot !== null) {
		const { default: fastifyStatic } = await import("@fastify/static")
		await app.register(fastifyStatic, {
			root: mountedRoot,
			prefix: "/",
			immutable: true,
		})
	}

	app.get("/", (_, reply) => {
		// Clickjacking guard for the SPA shell; plugin pages get their own
		// stricter CSP from the plugin-render route.
		reply.header("content-security-policy", "frame-ancestors 'self'")
		const html = spaIndexPath()
		if (html === undefined) return sendSpaUnavailable(reply)
		return sendFile(reply, html, {
			contentType: "text/html",
			cacheControl: "no-cache",
			conditional: { headers: reply.request.headers },
		})
	})

	// SW lives at `/sw.js` (scope `/`). `@fastify/static` ships static
	// assets with `immutable` headers but the Service Worker file itself
	// must be quickly invalidated when `RES_CACHE_NAME` is bumped — set
	// `no-cache` so browsers always revalidate the worker script. Without
	// `cacheControl: false` the plugin would overwrite `no-cache` with its
	// immutable header.
	app.get("/sw.js", (_, reply) => {
		reply.header("cache-control", "no-cache")
		if (mountedRoot === null || !isRegularFile(join(mountedRoot, "sw.js"))) {
			void reply.code(404).send()
			return
		}
		return reply.sendFile("sw.js", { cacheControl: false })
	})

	app.setNotFoundHandler((req, reply) => {
		// Only fall back to index.html for HTML navigations. Returning
		// index.html for missing JS/CSS/asset requests confuses browsers
		// (e.g. after a web rebuild produces new hashed asset names) by
		// serving HTML with a JS module's expected MIME type.
		if (!isHtmlNavigation(req)) {
			void reply.code(404).send()
			return
		}
		reply.header("cache-control", "no-cache")
		reply.header("content-security-policy", "frame-ancestors 'self'")
		if (spaIndexPath() === undefined) {
			void sendSpaUnavailable(reply)
			return
		}
		void reply.sendFile("index.html")
	})
}

function isHtmlNavigation(req: {
	url: string
	headers: { accept?: string }
}): boolean {
	if (req.url.startsWith("/trpc")) return false
	if (req.url.startsWith("/api")) return false
	const accept = req.headers.accept
	// Missing Accept header (common in tests and some clients) is treated
	// as HTML navigation for clean paths. Browsers always send an Accept
	// header, so this only loosens behavior for non-browser callers.
	if (accept !== undefined && accept !== "" && !accept.includes("text/html"))
		return false
	const path = req.url.split("?", 1)[0] ?? req.url
	const lastSegment = path.slice(path.lastIndexOf("/") + 1)
	// Treat any path whose final segment contains a dot as a static asset
	// request; SPA routes use clean paths without file extensions.
	return !lastSegment.includes(".")
}

const DRAINING_TIMEOUT_MS = 60_000
const DRAINING_RETRY_AFTER_SECONDS = "0"
const EVENTS_PATH = "/api/events"

function isEventsRequest(req: { readonly url: string }): boolean {
	return req.url === EVENTS_PATH || req.url.startsWith(`${EVENTS_PATH}?`)
}

/**
 * Track in-flight requests and park new requests while the storage context
 * is being reloaded. This prevents requests from holding a DB handle that is
 * about to be closed, while avoiding client-visible 503 errors.
 *
 * Requests that arrive after draining starts wait on the current
 * {@link app.reloadGate}. Once the reload finishes they continue normally
 * against the new DB/context.
 *
 * The SSE endpoint (/api/events) is excluded: it is long-lived and must stay
 * connected across the swap, and it must not be counted as an in-flight
 * request that blocks the drain.
 */
function installDrainingMiddleware(app: FastifyInstance): void {
	const counted = new WeakSet<FastifyRequest>()
	const completions = new WeakMap<FastifyRequest, (success: boolean) => void>()
	app.addHook("onRequest", (req, reply, done) => {
		const controller = new AbortController()
		let waiting = 0
		let announced = false
		const completion = Promise.withResolvers<boolean>()
		completions.set(req, completion.resolve)
		req.storageAbort = controller
		reply.raw.once("close", () => {
			app.activeStorageRequests.delete(req)
			if (counted.delete(req)) app.inflightRequests -= 1
			if (!reply.raw.writableFinished) controller.abort()
			completion.resolve(reply.raw.writableFinished && reply.statusCode < 400)
		})
		withStorageRequest(
			{
				signal: controller.signal,
				waiting: (value) => {
					waiting += value ? 1 : -1
					req.storageWaiting = waiting > 0
					if (value && !announced) {
						if (app.isDraining || app.libraryMaintenance) controller.abort()
						announced = true
						void app.protectionService
							.observeFileRequest({
								requestId: req.id,
								cancel: () => controller.abort(),
								finished: completion.promise,
							})
							.catch((error) =>
								app.log.error({ err: error }, "protection.file_queue_failed"),
							)
					}
				},
			},
			done,
		)
	})
	app.addHook("onRequest", async (req, reply) => {
		if (isEventsRequest(req)) return
		const url = req.url.split("?", 1)[0] ?? ""
		const protectionState = app.protectionService.getStatus()
		const inMaintenance =
			app.libraryMaintenance ||
			Boolean(protectionState.maintenance || protectionState.maintenanceError)
		const control =
			url.startsWith("/auth/") ||
			url.startsWith("/api/internal/") ||
			url.startsWith("/api/sync/") ||
			url === "/api/health" ||
			url === "/api/protection/state" ||
			(!url.startsWith("/api/") && !url.startsWith("/trpc/")) ||
			(url.startsWith("/trpc/") &&
				url
					.slice(6)
					.split(",")
					.every(
						(name) =>
							name.startsWith("protection.") ||
							name.startsWith("version.") ||
							name === "me" ||
							name === "ping",
					))
		if (
			inMaintenance &&
			(!control ||
				(url.startsWith("/trpc/") &&
					url
						.slice(6)
						.split(",")
						.some((name) => name.startsWith("version."))))
		) {
			return reply.code(503).send({
				error: "The library is in maintenance mode",
				maintenance: true,
			})
		}
		if (control) return

		app.inflightRequests += 1
		counted.add(req)
		app.activeStorageRequests.add(req)
		if (app.isDraining) {
			app.inflightRequests -= 1
			counted.delete(req)
			app.activeStorageRequests.delete(req)
			const gate = app.reloadGate
			if (gate === undefined) {
				return reply
					.header("Retry-After", DRAINING_RETRY_AFTER_SECONDS)
					.code(503)
					.send({ error: "server is reloading storage context" })
			}
			try {
				await gate.promise
			} catch {
				return reply
					.header("Retry-After", DRAINING_RETRY_AFTER_SECONDS)
					.code(503)
					.send({ error: "storage context reload failed" })
			}
			app.inflightRequests += 1
			counted.add(req)
			app.activeStorageRequests.add(req)
		}
	})
	app.addHook("onResponse", async (req, reply) => {
		completions.get(req)?.(
			!req.storageAbort?.signal.aborted && reply.statusCode < 400,
		)
		completions.delete(req)
		app.activeStorageRequests.delete(req)
		if (counted.delete(req)) app.inflightRequests -= 1
	})
}

/**
 * Apply a pending restore, then transplant the auth row from the previous
 * DB into the restored one. Restores bring back data but never
 * credentials: the admin password that worked before the restore keeps
 * working, and an unconfigured instance stays unconfigured.
 *
 * Runs with short-lived handles because this is always invoked at the
 * exact moment the live DB is being swapped (before any handle to the new
 * file exists).
 */
function applyPendingRestorePreservingAuth(
	paths: StoragePaths,
): ReturnType<typeof applyPendingRestore> {
	const result = applyPendingRestore({ paths })
	if (!result.applied) return result

	const previousPath = existsSync(result.previousPath)
		? result.previousPath
		: undefined
	let previousAuth: StoredAuthRow | undefined
	if (previousPath !== undefined) {
		const previous = openDb(previousPath, { readonly: true })
		try {
			previousAuth = getAuthRow(previous.db)
		} finally {
			previous.close()
		}
	}

	const restored = openDb(result.dbFilePath)
	try {
		// Backups may predate the no-credentials policy; never adopt their
		// auth row either way -- the previous row (or its absence) wins.
		deleteAuthRow(restored.db)
		if (previousAuth !== undefined) setAuthRow(restored.db, previousAuth)
	} finally {
		restored.close()
	}

	return result
}

/**
 * Hot-reload the storage context in-process.
 *
 * 1. Park new requests on a gate (they wait instead of receiving 503).
 * 2. Wait for pre-existing in-flight requests to finish.
 * 3. Close the old DB handle.
 * 4. Resolve the new storage context from disk.
 * 5. Open the new DB handle and run migrations if writable.
 * 6. Atomically swap the runtime refs and resolve the gate.
 * 7. Broadcast an SSE event so clients invalidate cached data.
 */
const contextReloads = new WeakMap<
	FastifyInstance,
	Promise<StorageReloadResult>
>()

export function reloadStorageContext(
	app: FastifyInstance,
): Promise<StorageReloadResult> {
	app.pendingStorageReloads++
	const previous = contextReloads.get(app) ?? Promise.resolve()
	const next = previous.catch(() => {}).then(() => reloadStorageContextNow(app))
	contextReloads.set(app, next)
	return next.finally(() => {
		app.pendingStorageReloads--
		if (contextReloads.get(app) === next) contextReloads.delete(app)
	})
}

async function reloadStorageContextNow(
	app: FastifyInstance,
): Promise<StorageReloadResult> {
	const refs = app.runtimeRefs as RuntimeRefs
	const env = app.env
	const log = app.log

	const gate = createDeferred<void>()
	app.reloadGate = gate
	app.isDraining = true
	app.pluginAssetConsent.dispose()
	for (const request of app.activeStorageRequests)
		if (request.storageWaiting) request.storageAbort?.abort()

	const start = Date.now()
	log.info("storage.reload.draining")

	try {
		// Wait for requests that started before draining to finish.
		const deadline = Date.now() + DRAINING_TIMEOUT_MS
		while (app.inflightRequests > 0 && Date.now() < deadline) {
			await setTimeout(50)
		}
		if (app.inflightRequests > 0) {
			throw new Error(
				"Active library requests did not finish before the storage switch",
			)
		}

		// Close the old handle before any file-level swaps happen.
		const oldHandles = refs.dbHandles.current
		try {
			oldHandles.close()
		} catch (err) {
			log.warn({ err }, "storage.reload.old_close_failed")
		}

		// Apply pending restore (no-op if marker missing) and resolve new state.
		const ctx = resolveStorageContext(env)
		applyPendingRestorePreservingAuth(ctx.paths)

		const newHandles = openDb(ctx.dbFilePath, { readonly: ctx.readOnly })
		if (!ctx.readOnly) migrateWithDedupe(newHandles, env, log)

		// Swap refs atomically.
		refs.dbHandles.current = newHandles
		refs.storagePaths.current = ctx.paths
		refs.readOnly.current = ctx.readOnly
		for (const reload of app.storageReloadHandlers) await reload()

		app.isDraining = false
		gate.resolve()

		const elapsed = Date.now() - start
		log.info(
			{
				elapsed,
				activeVersion: ctx.activeVersion,
				latestVersion: ctx.latestVersion,
				readOnly: ctx.readOnly,
			},
			"storage.reload.done",
		)

		app.sseBroadcaster.broadcast({ type: "storageContextReloaded" })

		return {
			storagePaths: ctx.paths,
			dbFilePath: ctx.dbFilePath,
			readOnly: ctx.readOnly,
			latestVersion: ctx.latestVersion,
			activeVersion: ctx.activeVersion,
		}
	} catch (err) {
		app.isDraining = false
		app.libraryMaintenance = true
		refs.readOnly.current = true
		gate.reject(err)
		throw err
	} finally {
		app.reloadGate = undefined
	}
}

/**
 * Wire the backup/version signals to an in-process storage reload.
 * The server process stays alive; clients learn about the reload via SSE.
 */
function subscribeContextReload(
	app: FastifyInstance,
	onContextReloaded: () => void,
): void {
	function logReloadError(err: unknown): void {
		app.log.error({ err }, "storage.reload.failed")
	}

	app.signals.on("backup.restoreRequested", () => {
		void reloadStorageContext(app).then(onContextReloaded, logReloadError)
	})
	app.signals.on("version.changed", () => {
		void reloadStorageContext(app).then(onContextReloaded).catch(logReloadError)
	})
}

function defaultContextReloaded(): void {
	// The server process stays alive; clients learn about the reload via SSE.
}

function buildResult(app: FastifyInstance): BuiltServer {
	return {
		app,
		db: app.dbHandles,
		sessions: app.sessions,
		storagePaths: app.paths,
		thumbs: app.thumbService,
		backups: app.backupService,
		close: async () => {
			await app.close()
		},
	}
}
