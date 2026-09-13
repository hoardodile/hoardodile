import { Button } from "@hoardodile/ui/components/button"
import { CardShell } from "@hoardodile/ui/components/card-shell"
import { Icon } from "@hoardodile/ui/components/icon"
import { toast } from "@hoardodile/ui/components/toast"
import { Box, PlugCircle, Restart } from "@hoardodile/ui/icons/registry"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { SettingsSection } from "@/features/settings/SettingsSection"
import { SectionDivider } from "@/features/settings/SettingsSheet"
import { errorMessage } from "@/lib/errors"
import type { RouterOutputs } from "@/trpc/client"
import { PluginTileIcon } from "./icons/plugin-tile-icon"
import { resolveManifestDescription, resolveManifestName } from "./manifestText"
import { PermissionMarks } from "./PluginSettingsPanel"
import {
	pluginKeys,
	pluginRestoreSeedMutation,
	pluginSeedsQueryOptions,
} from "./pluginApi"

type SeedPluginRow = RouterOutputs["plugin"]["listSeeds"][number]

/**
 * The settings page's bundled-plugins section: every official plugin that
 * ships with this app (the seed channel) which is NOT currently
 * installed. Uninstalling one keeps the bundled original on disk — the
 * removal marker makes boot-time seeding skip it — and this section
 * restores it from that original, fully offline, independent of the
 * marketplace registry configuration.
 *
 * Renders itself as one full settings section (with its leading divider)
 * below the Installed section. Hidden entirely when every bundled
 * plugin is installed or the host ships no bundled plugins.
 */
export function BundledPluginsSection() {
	const { t, i18n } = useTranslation()
	const qc = useQueryClient()
	const seedsQuery = useQuery(pluginSeedsQueryOptions())
	const rows = (seedsQuery.data ?? []).filter((row) => !row.installed)

	const restoreMut = useMutation({
		...pluginRestoreSeedMutation(),
		onSuccess: async (_result, id) => {
			await qc.invalidateQueries({ queryKey: pluginKeys.all })
			const row = rows.find((candidate) => candidate.id === id)
			toast.add({
				title: t("plugins.bundledRestoreSuccess", {
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
		<>
			<SectionDivider />
			<SettingsSection
				icon={Box}
				title={t("plugins.bundledTitle")}
				description={t("plugins.bundledDescription")}
				layout="stack"
				data-testid="plugins-bundled-section"
			>
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
			</SettingsSection>
		</>
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
		<CardShell
			icon={
				<PluginTileIcon
					iconRef={row.manifest.icon}
					pluginId={row.id}
					fallback={PlugCircle}
				/>
			}
			title={resolveManifestName(row.manifest, i18n.language)}
			iconTitle={t("plugins.installed")}
			meta={`v${row.manifest.version}`}
			description={resolveManifestDescription(row.manifest, i18n.language)}
			className="overflow-hidden"
			footer={
				<>
					<PermissionMarks
						p={{
							id: row.id,
							permissions: row.manifest.permissions,
							manifest: row.manifest,
						}}
					/>
					<div className="ml-auto flex shrink-0 items-center gap-2">
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
								{t("plugins.bundledRestore")}
							</Button>
						)}
					</div>
				</>
			}
		/>
	)
}
