import { index, integer, sqliteTable, text } from "drizzle-orm/sqlite-core"

/**
 * Domain table for {@link import("@hoardodile/schemas").SyncDevice}.
 * One row per record-tracking target device. Each device keeps its own
 * snapshot history and reminder state.
 */
export const syncDevices = sqliteTable("sync_devices", {
	id: text("id").primaryKey(),
	/** Device display name, trimmed, non-empty. */
	name: text("name").notNull(),
	/** Free-form notes; empty string when absent. */
	notes: text("notes").notNull().default(""),
	createdAt: integer("created_at").notNull(),
	updatedAt: integer("updated_at").notNull(),
})

/**
 * Domain table for {@link import("@hoardodile/schemas").SyncRecord}.
 * One row per automatically captured state snapshot for a device. Only
 * the newest snapshot per device is kept — it is the baseline the UI
 * diffs the live library state against. All values are captured
 * server-side at record time, never user-entered.
 */
export const syncRecords = sqliteTable(
	"sync_records",
	{
		id: text("id").primaryKey(),
		/** Owning device; deleting the device cascades to its records. */
		deviceId: text("device_id")
			.notNull()
			.references(() => syncDevices.id, { onDelete: "cascade" }),
		/** The moment the snapshot was recorded; the reminder counts from here. */
		recordedAt: integer("recorded_at").notNull(),
		/** Live (non-deleted) resource count at record time. */
		resourceCount: integer("resource_count").notNull().default(0),
		/** Live (non-deleted) character count at record time. */
		characterCount: integer("character_count").notNull().default(0),
		/** Live (non-deleted) document count (folders excluded) at record time. */
		documentCount: integer("document_count").notNull().default(0),
		/** Live (non-deleted) folder count in the document tree at record time. */
		folderCount: integer("folder_count").notNull().default(0),
		/** Live (non-deleted) comment count at record time. */
		commentCount: integer("comment_count").notNull().default(0),
		/** Tag count at record time. */
		tagCount: integer("tag_count").notNull().default(0),
		/** Collection count at record time. */
		collectionCount: integer("collection_count").notNull().default(0),
		/** Trashed (soft-deleted) resource count at record time. */
		trashCount: integer("trash_count").notNull().default(0),
		/** Total bytes the storage root occupies at record time. */
		storageBytes: integer("storage_bytes").notNull().default(0),
		/** Total bytes of live resource files at record time. */
		resourceBytes: integer("resource_bytes").notNull().default(0),
		createdAt: integer("created_at").notNull(),
	},
	(t) => [
		// Newest-first per-device listing (and the latest-row lookup for
		// the per-device reminder).
		index("sync_records_device_recorded_at_idx").on(t.deviceId, t.recordedAt),
	],
)
