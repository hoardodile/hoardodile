import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import { toast } from "@hoardodile/ui/components/toast"
import { PlugCircle, Restart } from "@hoardodile/ui/icons/registry"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { PluginTileIcon } from "@/features/plugin/icons/plugin-tile-icon"
import {
	resolveManifestDescription,
	resolveManifestName,
} from "@/features/plugin/manifestText"
import { PermissionMarks } from "@/features/plugin/PluginSettingsPanel"
import {
	pluginKeys,
	pluginRestoreSeedMutation,
	pluginSeedsQueryOptions,
} from "@/features/plugin/pluginApi"
import { errorMessage } from "@/lib/errors"
import type { RouterOutputs } from "@/trpc/client"

type SeedPluginRow = RouterOutputs["plugin"]["listSeeds"][number]

/**
 * The marketplace's bundled-plugins section: every official plugin that
 * ships with this app (the seed channel), with this host's relationship
 * to it. Uninstalling one keeps the bundled original on disk — the
 * removal marker makes boot-time seeding skip it — and this section
 * restores it from that original, fully offline.
 *
 * Renders above the catalog and independent of the registry
 * configuration: the restore action must work even with the marketplace
 * disabled. Hidden entirely when the host ships no bundled plugins.
 */
export function BundledPluginsSection() {
	const { t, i18n } = useTranslation()
	const qc = useQueryClient()
	const seedsQuery = useQuery(pluginSeedsQueryOptions())
	const rows = seedsQuery.data ?? []

	const restoreMut = useMutation({
		...pluginRestoreSeedMutation(),
		onSuccess: async (_result, id) => {
			await qc.invalidateQueries({ queryKey: pluginKeys.all })
			const row = rows.find((candidate) => candidate.id === id)
			toast.add({
				title: t("marketplace.bundledRestoreSuccess", {
					name:
						row !== undefined
							? resolveManifestName(row.manifest, i18n.language)
							: id,
				}),
				type: "success",
			})
		},
		onError: (err) => {
			toast.add({
				title: errorMessage(err, t("common.error")),
				type: "error",
			})
		},
	})

	if (rows.length === 0) return null

	return (
		<section
			className="flex flex-col gap-3"
			data-testid="bundled-plugins-section"
		>
			<div className="flex flex-col gap-1">
				<p className="text-sm font-semibold text-foreground">
					{t("marketplace.bundledTitle")}
				</p>
				<p className="text-xs text-muted-foreground">
					{t("marketplace.bundledDescription")}
				</p>
			</div>
			<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
				{rows.map((row) => (
					<BundledPluginCard
						key={row.id}
						row={row}
						restorePending={restoreMut.isPending}
						onRestore={() => restoreMut.mutate(row.id)}
					/>
				))}
			</div>
		</section>
	)
}

function BundledPluginCard(props: {
	readonly row: SeedPluginRow
	readonly restorePending: boolean
	readonly onRestore: () => void
}) {
	const { t, i18n } = useTranslation()
	const { row, restorePending, onRestore } = props
	return (
		<div className="flex flex-col gap-2.5 rounded-xl border border-border p-4">
			<div className="flex items-center gap-2.5">
				<PluginTileIcon
					iconRef={row.manifest.icon}
					pluginId={row.id}
					fallback={PlugCircle}
				/>
				<div className="min-w-0 flex-1">
					<span className="block truncate text-ui font-medium">
						{resolveManifestName(row.manifest, i18n.language)}
					</span>
					<span className="block truncate font-mono text-tiny text-muted-foreground">
						v{row.manifest.version}
					</span>
				</div>
			</div>
			<p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
				{resolveManifestDescription(row.manifest, i18n.language)}
			</p>
			<div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
				<PermissionMarks
					p={{
						id: row.id,
						permissions: row.manifest.permissions,
						manifest: row.manifest,
					}}
				/>
				<div className="ml-auto flex shrink-0 items-center gap-2">
					{row.installed ? (
						<MetaChip tone="inverse">
							{t("marketplace.installed", {
								version: row.installedVersion ?? row.manifest.version,
							})}
						</MetaChip>
					) : row.removed ? (
						<MetaChip>{t("marketplace.bundledRemoved")}</MetaChip>
					) : null}
					{row.restorable && (
						<Button
							size="sm"
							variant="secondary"
							disabled={restorePending}
							onClick={onRestore}
							data-testid={`bundled-restore-${row.id}`}
						>
							<Icon
								icon={Restart}
								className={restorePending ? "animate-spin" : ""}
							/>
							{t("marketplace.bundledRestore")}
						</Button>
					)}
				</div>
			</div>
		</div>
	)
}
