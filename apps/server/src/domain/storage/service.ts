import { type Dirent, statSync } from "node:fs"
import { readdir, stat } from "node:fs/promises"
import { isAbsolute, join, relative, sep } from "node:path"
import { sumDirSizes } from "@hoardodile/host/hoard"
import type { StorageOverview, StoragePluginUsage } from "@hoardodile/schemas"
import { fileStats as fileStatsSchema } from "@hoardodile/schemas"
import { eq, isNull } from "drizzle-orm"
import { resourceMeta, resources } from "src/domain/res/schema.ts"
import type { SqliteDb } from "src/infra/db/connection.ts"
import { volumeStatsOf } from "src/infra/disk.ts"
import type { StoragePaths } from "src/infra/storage/paths.ts"

export type StorageServiceDeps = {
	readonly db: SqliteDb
	readonly paths: StoragePaths
	readonly backupRoot?: string
	/**
	 * Display names keyed by content plugin id. Optional — unknown ids
	 * fall back to showing the raw id.
	 */
	readonly pluginNames?: ReadonlyMap<string, string>
	/**
	 * Low-space threshold: when the volume's free bytes fall below this,
	 * the overview reports `lowSpace` (and automatic snapshots pause).
	 * Optional — absent means the flag stays false.
	 */
	readonly lowSpaceThresholdBytes?: number
}

export type StorageService = {
	/**
	 * Disk usage overview of the storage root: volume stats, the recursive
	 * total, and a per-category breakdown (databases, caches, trash,
	 * backups, per-plugin resources). Expensive directory walks are cached
	 * for {@link OVERVIEW_CACHE_TTL_MS} so the settings page never pays
	 * for the scan twice in quick succession.
	 */
	getOverview(): Promise<StorageOverview>
}

const OVERVIEW_CACHE_TTL_MS = 60_000

/**
 * Build the storage accounting service. Resource sizes come from the
 * recorded `fileStats` metadata (no per-file stat calls); only the derived
 * trees that have no metadata (caches, trash, upload staging) and the
 * storage root total are walked on disk. The root walk also captures the
 * latest resource tree in the same pass, so resources without recorded
 * metadata can be attributed as `unattributedBytes` without any extra
 * per-resource stats.
 */
export function createStorageService(deps: StorageServiceDeps): StorageService {
	const { db, paths, pluginNames } = deps
	let cached: { at: number; value: Promise<StorageOverview> } | undefined

	function getOverview(): Promise<StorageOverview> {
		const now = Date.now()
		if (cached !== undefined && now - cached.at < OVERVIEW_CACHE_TTL_MS) {
			return cached.value
		}
		const value = computeOverview()
		cached = { at: now, value }
		return value
	}

	async function computeOverview(): Promise<StorageOverview> {
		const resourcesUsage = aggregateResourceUsage()
		const [volume, cacheBytes, trashBytes, stagingBytes, archivedBytes] =
			await Promise.all([
				readVolume(),
				dirSize(paths.local.cache()),
				dirSize(paths.local.trash()),
				dirSize(paths.local.uploadStagingRoot()),
				archivedCopiesSize(),
			])
		const databaseBytes = databaseSize()
		const configuredBackups = deps.backupRoot ?? join(paths.root, "backups")
		const backupRelative = relative(paths.root, configuredBackups)
		const backupsInsideRoot =
			backupRelative !== ".." &&
			!backupRelative.startsWith(`..${sep}`) &&
			!isAbsolute(backupRelative)
		const backupBytes = backupsInsideRoot ? await dirSize(configuredBackups) : 0
		const rootScan = await dirSizeWithSubtree(
			paths.root,
			paths.latest.resources(),
		)
		const usedBytes = rootScan.total

		// Resources whose bytes are not covered by the recorded per-plugin
		// metadata: the difference between the latest version's resource
		// tree on disk and the metadata total. Clamped — archived-version
		// metadata can exceed the latest tree when older versions hold
		// resources (those bytes are reported under `archivedBytes`).
		const unattributedBytes = Math.max(
			0,
			rootScan.subtree - resourcesUsage.totalBytes,
		)

		const accounted =
			databaseBytes +
			cacheBytes +
			stagingBytes +
			trashBytes +
			archivedBytes +
			backupBytes +
			resourcesUsage.totalBytes +
			unattributedBytes

		return {
			volume,
			usedBytes,
			databaseBytes,
			cacheBytes: cacheBytes + stagingBytes,
			trashBytes,
			archivedBytes,
			backupBytes,
			otherBytes: Math.max(0, usedBytes - accounted),
			lowSpace:
				volume !== null &&
				deps.lowSpaceThresholdBytes !== undefined &&
				volume.freeBytes < deps.lowSpaceThresholdBytes,
			resources: {
				...resourcesUsage,
				unattributedBytes,
			},
		}
	}

	async function readVolume(): Promise<StorageOverview["volume"]> {
		return (await volumeStatsOf(paths.root)) ?? null
	}

	/**
	 * Entity copies frozen in archived versions (`versions/<v>` with
	 * `v < latest`). These are immutable historical data the per-plugin
	 * metadata numbers do not cover: resources, characters, documents,
	 * and installed content plugins.
	 */
	async function archivedCopiesSize(): Promise<number> {
		let total = 0
		for (let v = 1; v < paths.latestVersion; v++) {
			const version = paths.atVersion(v)
			total += await dirSize(version.resources())
			total += await dirSize(version.characters())
			total += await dirSize(version.documents())
			total += await dirSize(version.plugins())
		}
		return total
	}

	/**
	 * Aggregate live (non-trashed) resources by content plugin from the
	 * recorded `fileStats.sizeBytes` metadata — the same number the
	 * resource detail page shows, summed per plugin. Resources whose
	 * size was never recorded (e.g. created before the metadata system,
	 * or never precached) are counted in `unattributedCount` instead; the
	 * corresponding bytes surface on disk as `unattributedBytes` in the
	 * overview, since no per-resource stats are taken here.
	 */
	function aggregateResourceUsage(): {
		totalBytes: number
		byPlugin: StoragePluginUsage[]
		unattributedCount: number
	} {
		const rows = db
			.select({
				pluginId: resources.contentPluginId,
				fileStats: resourceMeta.fileStats,
			})
			.from(resources)
			.leftJoin(resourceMeta, eq(resourceMeta.resourceId, resources.id))
			.where(isNull(resources.deletedAt))
			.all()

		const totals = new Map<
			string,
			{ sizeBytes: number; resourceCount: number }
		>()
		let unattributedCount = 0
		for (const row of rows) {
			const pluginId = row.pluginId ?? ""
			const entry = totals.get(pluginId) ?? { sizeBytes: 0, resourceCount: 0 }
			entry.resourceCount += 1
			const sizeBytes =
				row.fileStats === null ? undefined : fileStatsSizeBytes(row.fileStats)
			if (sizeBytes !== undefined) {
				entry.sizeBytes += sizeBytes
			} else {
				unattributedCount += 1
			}
			totals.set(pluginId, entry)
		}

		const byPlugin: StoragePluginUsage[] = [...totals.entries()]
			.map(([pluginId, usage]) => {
				const name = pluginNames?.get(pluginId)
				return {
					pluginId,
					...(name !== undefined ? { name } : {}),
					...usage,
				}
			})
			.sort((a, b) => b.sizeBytes - a.sizeBytes)

		return {
			totalBytes: byPlugin.reduce((sum, p) => sum + p.sizeBytes, 0),
			byPlugin,
			unattributedCount,
		}
	}

	function databaseSize(): number {
		const runtime = paths.runtimeDb()
		let total = fileSizeOrZero(runtime)
		// Uncheckpointed WAL pages are real disk usage of the live DB.
		for (const suffix of ["-wal", "-shm"]) {
			total += fileSizeOrZero(`${runtime}${suffix}`)
		}
		for (let v = 1; v <= paths.latestVersion; v++) {
			total += fileSizeOrZero(paths.atVersion(v).versionSnapshotDb())
		}
		return total
	}

	return { getOverview }
}

function fileStatsSizeBytes(raw: string): number | undefined {
	try {
		const parsed = fileStatsSchema.safeParse(JSON.parse(raw))
		return parsed.success && parsed.data.sizeBytes !== undefined
			? parsed.data.sizeBytes
			: undefined
	} catch {
		return undefined
	}
}

function fileSizeOrZero(path: string): number {
	try {
		return statSync(path).size
	} catch {
		return 0
	}
}

/**
 * Recursive byte size of a directory tree — the shared host walk
 * (symlinks skipped so cycles cannot hang the walk and linked-out files
 * are not double counted; missing/transient entries ignored).
 */
async function dirSize(root: string): Promise<number> {
	return sumDirSizes(root)
}

/**
 * One pass over `root` measuring the whole tree and, when `subtreeBase`
 * lies under it, the size of that subtree in the same walk — used for the
 * storage root so the latest resource tree is never re-scanned separately.
 * Symlinks are skipped so cycles cannot hang the walk and linked-out
 * files are not double counted. Missing/transient entries are ignored.
 */
async function dirSizeWithSubtree(
	root: string,
	subtreeBase: string,
): Promise<{ readonly total: number; readonly subtree: number }> {
	let total = 0
	let subtree = 0
	const stack: { readonly dir: string; readonly inSubtree: boolean }[] = [
		{ dir: root, inSubtree: false },
	]
	while (stack.length > 0) {
		const current = stack.pop()
		if (current === undefined) continue
		let entries: Dirent[]
		try {
			entries = await readdir(current.dir, { withFileTypes: true })
		} catch {
			continue
		}
		for (const entry of entries) {
			const full = join(current.dir, entry.name)
			const inSubtree = current.inSubtree || full === subtreeBase
			if (entry.isDirectory()) {
				stack.push({ dir: full, inSubtree })
			} else if (entry.isFile()) {
				try {
					const size = (await stat(full)).size
					total += size
					if (inSubtree) subtree += size
				} catch {
					// File disappeared between readdir and stat.
				}
			}
		}
	}
	return { total, subtree }
}
