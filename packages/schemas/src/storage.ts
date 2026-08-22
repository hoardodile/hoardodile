import { z } from "zod"

/**
 * Disk usage attributed to a single content plugin, aggregated from
 * resource metadata (the source archives' recorded byte sizes).
 */
export const storagePluginUsage = z.object({
	/** Content plugin id (`content_plugin_id` on resources). */
	pluginId: z.string().min(1),
	/** Display name from the plugin manifest; absent for unknown ids. */
	name: z.string().min(1).optional(),
	/** Sum of live resource source sizes owned by this plugin. */
	sizeBytes: z.number().int().nonnegative(),
	/** Number of live (non-trashed) resources owned by this plugin. */
	resourceCount: z.number().int().nonnegative(),
})

export type StoragePluginUsage = z.infer<typeof storagePluginUsage>

/**
 * Storage overview for the Settings → Data page. `usedBytes` is the
 * recursive on-disk size of the whole storage root; the category fields
 * break that total down so users can see where space went. `otherBytes`
 * absorbs whatever the categories do not cover (logs, installed plugins,
 * archived-version resource copies, characters, session key, ...).
 */
export const storageOverview = z.object({
	/**
	 * Total/free space of the filesystem backing the storage root
	 * (`fs.statfs`). `null` when the volume info cannot be read.
	 */
	volume: z
		.object({
			totalBytes: z.number().int().nonnegative(),
			freeBytes: z.number().int().nonnegative(),
		})
		.nullable(),
	/** Recursive on-disk size of the storage root. */
	usedBytes: z.number().int().nonnegative(),
	/** Live DB (incl. WAL/SHM) plus every archived per-version DB snapshot. */
	databaseBytes: z.number().int().nonnegative(),
	/** Derived caches under `local/cache/` and upload staging under `local/.tmp/`. */
	cacheBytes: z.number().int().nonnegative(),
	/** Contents of `local/trash/` (trashed resources/characters, restored DBs). */
	trashBytes: z.number().int().nonnegative(),
	/**
	 * Resource/character/document/plugin copies frozen in archived versions
	 * (`versions/<v>` with `v < latest`). These are real disk usage that
	 * the per-plugin metadata numbers do not cover.
	 */
	archivedBytes: z.number().int().nonnegative(),
	/** Manual (`db-backups/`) and automatic (`snapshots/`) DB snapshots. */
	backupBytes: z.number().int().nonnegative(),
	/** Storage not accounted for by the categories above. */
	otherBytes: z.number().int().nonnegative(),
	/**
	 * True when the storage volume has less free space than the configured
	 * low-disk threshold — automatic snapshots are paused while this holds.
	 */
	lowSpace: z.boolean(),
	resources: z.object({
		/**
		 * Sum of live resource source sizes across all plugins, from the
		 * recorded `fileStats.sizeBytes` metadata only. Resources without
		 * recorded sizes are not attributed to a plugin — see
		 * `unattributedBytes`.
		 */
		totalBytes: z.number().int().nonnegative(),
		byPlugin: z.array(storagePluginUsage),
		/**
		 * Live resources whose source bytes are not covered by
		 * `totalBytes` (no recorded `fileStats.sizeBytes`). Measured as
		 * `dirSize(<latest>/resources) − totalBytes` in a single scan, so
		 * it also absorbs covers, zip overhead, and leftover soft-deleted
		 * folders — nothing extra is stat'ed per resource. Runs precache
		 * to record the missing metadata and fold these into `byPlugin`.
		 */
		unattributedBytes: z.number().int().nonnegative(),
		/** Number of live resources without a recorded size. */
		unattributedCount: z.number().int().nonnegative(),
	}),
})

export type StorageOverview = z.infer<typeof storageOverview>
