import { Separator } from "@hoardodile/ui/components/separator"
import { useQuery } from "@tanstack/react-query"
import { Link } from "@tanstack/react-router"
import { useTranslation } from "react-i18next"
import { storageOverviewQueryOptions } from "@/features/storage/api"
import { buildStorageSegments } from "@/features/storage/segments"
import { formatBytes } from "@/lib/formatBytes"

/**
 * Sidebar storage strip — the shell's quiet meter (DESIGN — SidebarNav):
 * the bar is scoped to the archive's own bytes and fills with the owner
 * segments, so the muted remainder can never read as free disk. Occupied
 * and remaining disk appear as text (no volume total). Then the top-4
 * owners as a dotted legend. Same anatomy as the Settings → Data
 * breakdown; opens Settings → Data. Renders nothing until the overview
 * has loaded.
 */
export function SidebarStorageStrip(props: {
	readonly onNavigate?: () => void
}) {
	const { t } = useTranslation()
	const overview = useQuery(storageOverviewQueryOptions()).data
	if (overview === undefined) {
		return null
	}

	const segments = buildStorageSegments(overview, t)
	const totalBytes = segments.reduce((sum, segment) => sum + segment.bytes, 0)
	const topSegments = [...segments]
		.sort((a, b) => b.bytes - a.bytes)
		.slice(0, 4)

	return (
		<>
			<Separator size="seam" className="mt-2 mb-2" />
			<Link
				to="/settings/data"
				onClick={props.onNavigate}
				className="group block w-full"
			>
				<span className="flex items-baseline justify-between">
					<span className="text-tiny text-muted-foreground group-hover:text-secondary-foreground">
						{t("storage.sectionTitle")}
					</span>
					<span className="text-tiny text-muted-foreground tabular-nums group-hover:text-secondary-foreground">
						{t("storage.sidebarUsed", {
							size: formatBytes(overview.usedBytes),
						})}
						{overview.volume !== null
							? ` · ${t("storage.sidebarFree", {
									size: formatBytes(overview.volume.freeBytes),
								})}`
							: null}
					</span>
				</span>
				<span
					data-testid="sidebar-storage-bar"
					className="mt-1 flex h-1 overflow-hidden rounded-full bg-muted"
				>
					{segments.map((segment) => (
						<span
							key={segment.id}
							className="h-full shrink-0"
							style={{
								backgroundColor: segment.color,
								width: `${Math.max(
									(segment.bytes / totalBytes) * 100,
									MIN_SEGMENT_PERCENT,
								)}%`,
							}}
						/>
					))}
				</span>
				<span className="mt-1 grid grid-cols-2 gap-x-3">
					{topSegments.map((segment) => (
						<span
							key={segment.id}
							className="flex min-w-0 items-center gap-1.5 py-0.5"
						>
							<span
								className="size-1.5 shrink-0 rounded-full"
								style={{ backgroundColor: segment.color }}
							/>
							<span className="min-w-0 flex-1 truncate text-tiny text-secondary-foreground">
								{segment.label}
							</span>
							<span className="shrink-0 text-tiny text-muted-foreground tabular-nums">
								{formatBytes(segment.bytes)}
							</span>
						</span>
					))}
				</span>
			</Link>
		</>
	)
}

/** Strip segments — the shared storage segment builder (features/storage/
    segments.ts): per-plugin resource storage plus the host-side owners,
    with the archived-version rows folded into one "Archived" owner so the
    shell meter stays about categories, not versions. Zero-byte owners are
    dropped by the builder. */

/** Segments thinner than this share would vanish — floor them so the
    legend's promise (there *is* cache, trash…) stays visible. */
const MIN_SEGMENT_PERCENT = 0.8
