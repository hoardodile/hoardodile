/**
 * Headless composition root for the official demo seed: storage, plugins,
 * and domain services without Fastify. Mirrors the server plugin boot path
 * so detect / meta rebuild run through the real sandbox.
 */

import { existsSync } from "node:fs"
import { join } from "node:path"
import {
	createPluginHooks,
	createPluginLoader,
	createPluginSandbox,
	DEFAULT_SANDBOX_CONFIG,
	type PluginHooks,
	type PluginSandbox,
	seedPlugins,
} from "@hoardodile/host"
import { writeVersioned } from "@hoardodile/host/hoard"
import type { Env } from "src/config/env.ts"
import { resolveWorkspaceRoot } from "src/config/env.ts"
import {
	type CatService,
	createCategoryService,
} from "src/domain/cat/service.ts"
import {
	createRelationshipService,
	type RelationshipService,
} from "src/domain/char/relationship_service.ts"
import {
	type CharService,
	createCharacterService,
} from "src/domain/char/service.ts"
import {
	createResourceCollectionService,
	type ResCollectionService,
} from "src/domain/col/service.ts"
import {
	type CommentService,
	createCommentService,
} from "src/domain/comment/service.ts"
import {
	createDanmakuService,
	type DanmakuService,
} from "src/domain/danmaku/service.ts"
import {
	createDocumentService,
	type DocService,
} from "src/domain/doc/service.ts"
import {
	createPluginService,
	type PluginService,
} from "src/domain/plugin/service.ts"
import { createPluginSettingsStore } from "src/domain/plugin/settings-store.ts"
import {
	createResourceService,
	type ResService,
} from "src/domain/res/service.ts"
import { buildResourceUploads, type ResUploads } from "src/domain/res/upload.ts"
import {
	createStorageService,
	type StorageService,
} from "src/domain/storage/service.ts"
import { createSyncService, type SyncService } from "src/domain/sync/service.ts"
import { createTagService, type TagService } from "src/domain/tag/service.ts"
import {
	createTraitService,
	type TraitService,
} from "src/domain/trait/service.ts"
import { type DbHandles, openDb } from "src/infra/db/connection.ts"
import { resolveStorageContext } from "src/infra/storage/bootstrap.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"
import { FILE_PLUGIN_ID, GALLERY_PLUGIN_ID } from "./catalog.ts"

export type SeedRuntime = {
	readonly env: Env
	readonly paths: StoragePaths
	readonly db: DbHandles
	readonly pluginHooks: PluginHooks
	readonly uploads: ResUploads
	readonly plugins: PluginService
	readonly res: ResService
	readonly cats: CatService
	readonly tags: TagService
	readonly traits: TraitService
	readonly chars: CharService
	readonly relationships: RelationshipService
	readonly cols: ResCollectionService
	readonly docs: DocService
	readonly comments: CommentService
	readonly danmaku: DanmakuService
	readonly storage: StorageService
	readonly sync: SyncService
	readonly close: () => Promise<void>
}

function assertPluginDir(dir: string, label: string): void {
	const manifest = join(dir, "manifest.json")
	if (existsSync(manifest)) return
	throw new Error(
		`${label} is missing ${manifest}; build the plugin first (pnpm build).`,
	)
}

function gallerySeedDirs(env: Env): readonly string[] {
	if (env.SEED_PLUGIN_PATHS.length > 0) return env.SEED_PLUGIN_PATHS
	return [join(resolveWorkspaceRoot(), "plugins", "gallery", "dist")]
}

/**
 * Open the live storage root, seed gallery onto disk, load the plugin
 * sandbox, and construct domain services. Throws when the instance is
 * viewing a past version.
 */
export async function openSeedRuntime(env: Env): Promise<SeedRuntime> {
	const ctx = resolveStorageContext(env)
	if (ctx.readOnly) {
		throw new Error(
			"seed: cannot write while viewing a past version (read-only)",
		)
	}
	const builtinDir = env.BUILTIN_PATH
	if (builtinDir === undefined) {
		throw new Error("Builtin plugin path is required: set BUILTIN_PATH env.")
	}
	assertPluginDir(builtinDir, "BUILTIN_PATH")
	const seedDirs = gallerySeedDirs(env)
	for (const dir of seedDirs) {
		assertPluginDir(dir, "gallery seed")
	}

	const db = openDb(ctx.dbFilePath)
	try {
		db.runMigrations()
		const paths = ctx.paths
		const readOnly = { current: false }

		await writeVersioned(paths, false, (latest) => {
			seedPlugins(latest.plugins(), seedDirs)
		})

		const sandbox = createPluginSandbox({
			...DEFAULT_SANDBOX_CONFIG,
			watchdogMs: env.PLUGIN_WATCHDOG_TIMEOUT_MS,
			hardTimeoutMs: env.PLUGIN_HOOK_HARD_TIMEOUT_MS,
			maxOldSpaceMb: env.PLUGIN_WORKER_MAX_OLD_SPACE_MB,
		})
		try {
			return await assembleRuntime(
				env,
				db,
				paths,
				readOnly,
				sandbox,
				builtinDir,
			)
		} catch (err) {
			await sandbox.disposeAll()
			throw err
		}
	} catch (err) {
		db.close()
		throw err
	}
}

async function assembleRuntime(
	env: Env,
	db: DbHandles,
	paths: StoragePaths,
	readOnly: { current: boolean },
	sandbox: PluginSandbox,
	builtinDir: string,
): Promise<SeedRuntime> {
	const loader = createPluginLoader({
		builtinDir,
		devPluginDirs: env.DEV_PLUGIN_PATHS,
		seedPluginDirs: [],
		pluginsDir: paths.atVersion(paths.activeVersion).plugins(),
		settings: createPluginSettingsStore(db.db),
		disableDevPlugins: env.DISABLE_DEV_PLUGINS,
		sandbox,
	})
	await loader.loadAll()

	const pluginService = createPluginService({
		db: db.db,
		loader,
		sandbox,
		readOnly: false,
	})
	pluginService.syncRecords()

	function liveRegistry() {
		return loader.getRegistry()
	}

	if (liveRegistry().getById(GALLERY_PLUGIN_ID) === undefined) {
		throw new Error(
			`seed: gallery plugin ${GALLERY_PLUGIN_ID} is not in the registry`,
		)
	}
	if (liveRegistry().getById(FILE_PLUGIN_ID) === undefined) {
		throw new Error(
			`seed: file plugin ${FILE_PLUGIN_ID} is not in the registry`,
		)
	}

	const pluginHooks = createPluginHooks({ getRegistry: liveRegistry })
	const uploads = buildResourceUploads(
		paths,
		{ maxArchiveExtractedBytes: env.MAX_ARCHIVE_EXTRACTED_BYTES },
		readOnly,
	)
	const res = createResourceService({
		db: db.db,
		paths,
		readOnly,
		uploads,
		pluginHooks,
		maxPluginExtractBytes: env.MAX_PLUGIN_EXTRACT_BYTES,
		maxPluginExtractEntries: env.MAX_PLUGIN_EXTRACT_ENTRIES,
	})
	const storage = createStorageService({
		db: db.db,
		paths,
		pluginNames: new Map(
			pluginService
				.listAll()
				.map((plugin) => [plugin.id, plugin.manifest.name]),
		),
		lowSpaceThresholdBytes: env.MIN_FREE_DISK_BYTES,
	})

	async function close(): Promise<void> {
		await sandbox.disposeAll()
		db.close()
	}

	return {
		env,
		paths,
		db,
		pluginHooks,
		uploads,
		plugins: pluginService,
		res,
		cats: createCategoryService({ db: db.db }),
		tags: createTagService({ db: db.db }),
		traits: createTraitService({ db: db.db }),
		chars: createCharacterService({ db: db.db, paths, readOnly }),
		relationships: createRelationshipService({ db: db.db }),
		cols: createResourceCollectionService({ db: db.db }),
		docs: createDocumentService({ db: db.db }),
		comments: createCommentService({
			db: db.db,
			getRegistry: liveRegistry,
		}),
		danmaku: createDanmakuService({
			db: db.db,
			getRegistry: liveRegistry,
		}),
		storage,
		sync: createSyncService({ db: db.db, storageService: storage }),
		close,
	}
}
