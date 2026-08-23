import type { Translate } from "@/i18n"
import type { StorageOverview } from "./api"

export type StorageSegmentGroup = "plugins" | "host" | "archived" | "cache"

export type StorageSegment = {
	readonly id: string
	readonly label: string
	readonly bytes: number
	readonly color: string
	readonly group: StorageSegmentGroup
	readonly subLabel?: string
	readonly tip?: string
}

/** Host-side owner colors, one per category. */
export const STORAGE_CATEGORY_COLORS = {
	unattributed: "#9387ab",
	archived: "#9678a6",
	backups: "#6a8f88",
	database: "#a6737b",
	cache: "#c2a24d",
	trash: "#e8a0bf",
	other: "#9a9a96",
} as const

/** Per-plugin colors — assigned in overview order, so the palette is
    deterministic for a given storage layout. */
export const PLUGIN_PALETTE = [
	"#7b8fa6",
	"#8a9a7b",
	"#b0824a",
	"#9d9d9d",
	"#a6737b",
	"#9678a6",
	"#9387ab",
	"#c2a24d",
] as const

function paletteColor(index: number): string {
	const color = PLUGIN_PALETTE[index % PLUGIN_PALETTE.length]
	if (color === undefined) {
		throw new Error("plugin palette must not be empty")
	}
	return color
}

/**
 * Storage segments for the allocation bar and legend, grouped by owner —
 * per-plugin resource storage (the bulk), then the host-side categories.
 * Zero-byte owners are dropped (they are not worth a legend dot).
 */
export function buildStorageSegments(
	overview: StorageOverview,
	t: Translate,
): readonly StorageSegment[] {
	const segments: StorageSegment[] = overview.resources.byPlugin.map(
		(plugin, index) => ({
			id: `plugin:${plugin.pluginId}`,
			label: plugin.name ?? plugin.pluginId,
			bytes: plugin.sizeBytes,
			color: paletteColor(index),
			group: "plugins",
			subLabel: t("storage.pluginCount", { count: plugin.resourceCount }),
		}),
	)
	if (overview.resources.unattributedCount > 0) {
		segments.push({
			id: "unattributed",
			label: t("storage.category.unattributedResources"),
			bytes: overview.resources.unattributedBytes,
			color: STORAGE_CATEGORY_COLORS.unattributed,
			group: "plugins",
			subLabel: t("storage.unattributedCount", {
				count: overview.resources.unattributedCount,
			}),
			tip: t("storage.unattributedHint"),
		})
	}
	const hostRows: StorageSegment[] = [
		{
			id: "archived",
			label: t("storage.category.archived"),
			bytes: overview.archivedBytes,
			color: STORAGE_CATEGORY_COLORS.archived,
			group: "archived",
			tip: t("storage.archivedHint"),
		},
		{
			id: "other",
			label: t("storage.category.other"),
			bytes: overview.otherBytes,
			color: STORAGE_CATEGORY_COLORS.other,
			group: "host",
			tip: t("storage.otherHint"),
		},
		{
			id: "backups",
			label: t("storage.category.backups"),
			bytes: overview.backupBytes,
			color: STORAGE_CATEGORY_COLORS.backups,
			group: "host",
			tip: t("storage.backupsHint"),
		},
		{
			id: "database",
			label: t("storage.category.database"),
			bytes: overview.databaseBytes,
			color: STORAGE_CATEGORY_COLORS.database,
			group: "host",
		},
		{
			id: "cache",
			label: t("storage.category.cache"),
			bytes: overview.cacheBytes,
			color: STORAGE_CATEGORY_COLORS.cache,
			group: "cache",
			tip: t("storage.cacheHint"),
		},
		{
			id: "trash",
			label: t("storage.category.trash"),
			bytes: overview.trashBytes,
			color: STORAGE_CATEGORY_COLORS.trash,
			group: "host",
		},
	]
	return [...segments, ...hostRows].filter((segment) => segment.bytes > 0)
}
