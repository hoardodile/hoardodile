import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { Icon } from "@hoardodile/ui/components/icon"
import {
	IconToggle,
	type IconToggleOption,
} from "@hoardodile/ui/components/icon-toggle"
import { Switch } from "@hoardodile/ui/components/switch"
import { toast } from "@hoardodile/ui/components/toast"
import {
	ListVertical,
	PlugCircle,
	Refresh,
	Widget2,
} from "@hoardodile/ui/icons/registry"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "@/components/common/ExternalLink"
import { PluginTileIcon } from "@/features/plugin/icons/plugin-tile-icon"
import {
	resolveManifestDescription,
	resolveManifestName,
} from "@/features/plugin/manifestText"
import { PluginPermissionBadges } from "@/features/plugin/PluginPermissionBadges"
import {
	PermissionMarks,
	PluginUninstallDialog,
} from "@/features/plugin/PluginSettingsPanel"
import {
	pluginKeys,
	pluginListAllQueryOptions,
} from "@/features/plugin/pluginApi"
import { errorMessage } from "@/lib/errors"
import { isNewer } from "@/lib/versions"
import type { RouterOutputs } from "@/trpc/client"
import {
	marketplaceConfigQueryOptions,
	marketplaceInstall,
	marketplaceKeys,
	marketplaceRefreshMutation,
	marketplaceSetConfigMutation,
	marketplaceSnapshotQueryOptions,
} from "./marketplaceApi"

type MarketPlugin = RouterOutputs["marketplace"]["snapshot"]["plugins"][number]

type MarketplaceView = "grid" | "list"

type InstallTarget = {
	readonly plugin: MarketPlugin
	readonly mode: "install" | "update"
	/** Installed version before an update — shown as the version arrow. */
	readonly installedVersion?: string
}

/**
 * Plugin marketplace: a registry repo (a GitHub repo whose root
 * `registry.json` lists plugin repository addresses) plus one catalog
 * card per plugin — metadata read straight from each repo and its latest
 * GitHub release.
 */
export function MarketplacePanel() {
	const { t, i18n } = useTranslation()
	const qc = useQueryClient()
	const configQuery = useQuery(marketplaceConfigQueryOptions())
	const registryRepo = configQuery.data?.registryRepo ?? null
	const snapshotQuery = useQuery({
		...marketplaceSnapshotQueryOptions(),
		enabled: registryRepo !== null,
	})
	const installedQuery = useQuery(pluginListAllQueryOptions())
	const [view, setView] = useState<MarketplaceView>("grid")
	const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null)
	const [detailTarget, setDetailTarget] = useState<MarketPlugin | null>(null)
	const [uninstallTarget, setUninstallTarget] = useState<MarketPlugin | null>(
		null,
	)

	const viewOptions: readonly IconToggleOption<MarketplaceView>[] = [
		{ value: "list", icon: ListVertical, label: t("plugins.listView") },
		{ value: "grid", icon: Widget2, label: t("plugins.gridView") },
	]

	const refreshMut = useMutation({
		...marketplaceRefreshMutation(),
		onSuccess: (snapshot) => {
			qc.setQueryData(marketplaceKeys.snapshot(), snapshot)
			toast.add({ title: t("marketplace.refreshed"), type: "success" })
		},
		onError: (err) => {
			toast.add({
				title: errorMessage(err, t("marketplace.refreshFailed")),
				type: "error",
			})
		},
	})

	const installMut = useMutation({
		mutationFn: (target: InstallTarget) =>
			marketplaceInstall({
				id: target.plugin.id,
				assetUrl: target.plugin.latest?.assetUrl ?? "",
				sha256: target.plugin.latest?.sha256,
			}),
		onSuccess: (_result, target) => {
			setInstallTarget(null)
			void qc.invalidateQueries({ queryKey: pluginKeys.all })
			toast.add({
				title:
					target.mode === "update"
						? t("marketplace.updateSuccess", {
								name: target.plugin.name,
								version: target.plugin.latest?.version,
							})
						: t("marketplace.installSuccess", { name: target.plugin.name }),
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

	const installedById = new Map(
		(installedQuery.data ?? []).map((row) => [row.id, row]),
	)

	return (
		<div className="flex flex-col gap-4">
			<MarketplaceConfigRow registryRepo={registryRepo} />

			{registryRepo === null ? (
				<p className="text-sm text-muted-foreground">
					{t("marketplace.notConfiguredHint")}
				</p>
			) : snapshotQuery.isPending ? (
				<p className="text-sm text-muted-foreground">
					{t("marketplace.loading")}
				</p>
			) : snapshotQuery.isError ? (
				<p className="text-sm text-destructive">
					{t("marketplace.loadFailed", {
						message: errorMessage(snapshotQuery.error, t("common.error")),
					})}
				</p>
			) : (
				<>
					<div className="flex items-center justify-between gap-2">
						<p className="text-xs text-muted-foreground">
							{t("marketplace.refreshedAt", {
								time:
									snapshotQuery.data === undefined
										? ""
										: new Date(snapshotQuery.data.fetchedAt).toLocaleString(
												i18n.language,
											),
							})}
						</p>
						<div className="flex items-center gap-2">
							<IconToggle
								options={viewOptions}
								value={view}
								onChange={setView}
							/>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => refreshMut.mutate()}
								disabled={refreshMut.isPending}
								data-testid="marketplace-refresh"
							>
								<Icon
									icon={Refresh}
									className={refreshMut.isPending ? "animate-spin" : ""}
								/>
								{t("marketplace.refresh")}
							</Button>
						</div>
					</div>

					{snapshotQuery.data?.plugins.length === 0 && (
						<p className="text-sm text-muted-foreground">
							{t("marketplace.emptyHint")}
						</p>
					)}

					<div
						className={
							view === "grid"
								? "grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
								: "flex flex-col divide-y divide-border"
						}
						data-testid="marketplace-catalog"
						data-view={view}
					>
						{snapshotQuery.data?.plugins.map((plugin) =>
							view === "grid" ? (
								<MarketplaceCard
									key={plugin.id}
									plugin={plugin}
									installed={installedById.get(plugin.id)}
									onInstall={() =>
										setInstallTarget({ plugin, mode: "install" })
									}
									onUpdate={() =>
										setInstallTarget({
											plugin,
											mode: "update",
											installedVersion: installedById.get(plugin.id)?.manifest
												.version,
										})
									}
									onDetails={() => setDetailTarget(plugin)}
									onUninstall={() => setUninstallTarget(plugin)}
								/>
							) : (
								<MarketplaceListRow
									key={plugin.id}
									plugin={plugin}
									installed={installedById.get(plugin.id)}
									onInstall={() =>
										setInstallTarget({ plugin, mode: "install" })
									}
									onUpdate={() =>
										setInstallTarget({
											plugin,
											mode: "update",
											installedVersion: installedById.get(plugin.id)?.manifest
												.version,
										})
									}
									onDetails={() => setDetailTarget(plugin)}
									onUninstall={() => setUninstallTarget(plugin)}
								/>
							),
						)}
					</div>

					{(snapshotQuery.data?.errors.length ?? 0) > 0 && (
						<div className="rounded-lg border border-destructive/30 p-3">
							<p className="mb-1 text-xs font-medium text-destructive">
								{t("marketplace.registryErrorsTitle")}
							</p>
							<ul className="flex flex-col gap-1">
								{snapshotQuery.data?.errors.map((entry) => (
									<li
										key={entry.repo}
										className="text-xs text-muted-foreground"
									>
										<span className="font-mono">{entry.repo}</span> —{" "}
										{entry.message}
									</li>
								))}
							</ul>
						</div>
					)}
				</>
			)}

			<MarketplaceInstallDialog
				request={installTarget}
				onOpenChange={(open) => {
					if (!open) setInstallTarget(null)
				}}
				isPending={installMut.isPending}
				onConfirm={() => {
					if (installTarget !== null) installMut.mutate(installTarget)
				}}
			/>
			<MarketplaceDetailDialog
				plugin={detailTarget}
				onOpenChange={(open) => {
					if (!open) setDetailTarget(null)
				}}
			/>
			{uninstallTarget !== null && (
				<PluginUninstallDialog
					pluginId={uninstallTarget.id}
					pluginName={uninstallTarget.name}
					open
					onOpenChange={(open) => {
						if (!open) setUninstallTarget(null)
					}}
				/>
			)}
		</div>
	)
}

/** Registry repo address + save/disable — one labeled field. */
function MarketplaceConfigRow(props: { readonly registryRepo: string | null }) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	const [value, setValue] = useState("")
	const saveMut = useMutation({
		...marketplaceSetConfigMutation(),
		onSuccess: () => {
			void qc.invalidateQueries({ queryKey: marketplaceKeys.config() })
			void qc.invalidateQueries({ queryKey: marketplaceKeys.snapshot() })
			toast.add({
				title: t("marketplace.saved", { repo: value }),
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

	return (
		<div className="flex flex-col gap-1">
			<label className="flex flex-col gap-1">
				<span className="text-xs font-medium">
					{t("marketplace.registryRepoLabel")}
				</span>
				<div className="flex min-w-0 items-center gap-2">
					<input
						value={value}
						onChange={(e) => setValue(e.target.value)}
						placeholder={
							props.registryRepo !== null
								? marketRepoUrl(props.registryRepo)
								: t("marketplace.registryPlaceholder")
						}
						className="h-9 min-w-0 flex-1 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
						data-testid="marketplace-registry-input"
					/>
					<Button
						onClick={() => saveMut.mutate({ registryRepo: value })}
						disabled={value.length === 0 || saveMut.isPending}
						data-testid="marketplace-registry-save"
					>
						{t("marketplace.save")}
					</Button>
				</div>
			</label>
			<p className="text-xs text-muted-foreground">
				{props.registryRepo === null
					? t("marketplace.setupHint")
					: t("marketplace.registryActive", {
							url: marketRepoUrl(props.registryRepo),
						})}
			</p>
		</div>
	)
}

/** `owner/repo` → its GitHub page URL (the display form the UI shows). */
function marketRepoUrl(repo: string): string {
	return `https://github.com/${repo}`
}

/** `v1.2.3 · Jan 2, 2025` — the version+date meta line under a title. */
function versionDateLine(
	latest:
		| {
				readonly version: string
				readonly publishedAt: string | null | undefined
		  }
		| undefined,
	language: string,
): string {
	if (latest === undefined) return ""
	const date =
		latest.publishedAt === null || latest.publishedAt === undefined
			? ""
			: ` · ${new Date(latest.publishedAt).toLocaleDateString(language, {
					year: "numeric",
					month: "short",
					day: "numeric",
				})}`
	return `v${latest.version}${date}`
}

function MarketplaceCard(props: {
	readonly plugin: MarketPlugin
	readonly installed?: RouterOutputs["plugin"]["listAll"][number]
	readonly onInstall: () => void
	readonly onUpdate: () => void
	readonly onDetails: () => void
	readonly onUninstall: () => void
}) {
	const { t, i18n } = useTranslation()
	const { plugin, installed } = props
	const latest = plugin.state === "ok" ? plugin.latest : undefined
	const canInstall = latest?.assetUrl !== undefined
	const installedVersion = installed?.manifest.version
	const updateAvailable =
		installedVersion !== undefined &&
		latest !== undefined &&
		isNewer(latest.version, installedVersion)

	return (
		<div
			className="flex flex-col gap-2.5 rounded-xl border border-border p-4 transition-colors hover:bg-accent/40"
			data-testid={`marketplace-plugin-${plugin.id}`}
		>
			<div className="flex items-center gap-2.5">
				<PluginTileIcon
					iconRef={plugin.icon}
					pluginId={plugin.id}
					fallback={PlugCircle}
				/>
				<div className="min-w-0 flex-1">
					<span className="block truncate text-ui font-medium">
						{resolveManifestName(plugin.manifest, i18n.language)}
					</span>
					<span className="block truncate font-mono text-tiny text-muted-foreground">
						{versionDateLine(latest, i18n.language)}
					</span>
				</div>
				{/* Installed ⇄ not-installed, like the plugins page toggle. */}
				<Switch
					checked={installedVersion !== undefined}
					disabled={!canInstall}
					onCheckedChange={(checked) => {
						if (checked) props.onInstall()
						else props.onUninstall()
					}}
					aria-label={t("marketplace.installToggle")}
					data-testid={`marketplace-toggler-${plugin.id}`}
				/>
			</div>
			<p className="line-clamp-2 min-h-8 text-xs text-muted-foreground">
				{resolveManifestDescription(plugin.manifest, i18n.language)}
			</p>
			<div className="flex min-w-0 items-center gap-1.5 overflow-hidden">
				<PermissionMarks
					p={{
						id: plugin.id,
						permissions: plugin.permissions,
						manifest: plugin.manifest,
					}}
				/>
				<div className="ml-auto flex shrink-0 items-center gap-2">
					{plugin.state === "no_release" && (
						<span className="inline-flex h-6 shrink-0 items-center rounded-full bg-muted px-2 text-tiny text-muted-foreground">
							{t("marketplace.noRelease")}
						</span>
					)}
					{plugin.state === "error" && (
						<span
							className="max-w-40 truncate text-xs text-destructive"
							title={plugin.error}
						>
							{plugin.error}
						</span>
					)}
					{updateAvailable && (
						<Button
							size="sm"
							variant="secondary"
							onClick={props.onUpdate}
							disabled={!canInstall}
							data-testid={`marketplace-update-${plugin.id}`}
						>
							{t("marketplace.updateTo", { version: latest.version })}
						</Button>
					)}
					<Button
						size="sm"
						variant="secondary"
						onClick={props.onDetails}
						data-testid={`marketplace-details-${plugin.id}`}
					>
						{t("marketplace.details")}
					</Button>
				</div>
			</div>
		</div>
	)
}

/** Read-only detail view — everything the card hides, in one place. */
function MarketplaceDetailDialog(props: {
	readonly plugin: MarketPlugin | null
	readonly onOpenChange: (open: boolean) => void
}) {
	const { t, i18n } = useTranslation()
	const plugin = props.plugin
	const latest = plugin?.state === "ok" ? plugin.latest : undefined

	return (
		<AppDialog
			open={plugin !== null}
			onOpenChange={props.onOpenChange}
			title={
				plugin !== null
					? resolveManifestName(plugin.manifest, i18n.language)
					: ""
			}
			icon={
				plugin !== null ? (
					<PluginTileIcon
						iconRef={plugin.icon}
						pluginId={plugin.id}
						fallback={PlugCircle}
					/>
				) : undefined
			}
			description={
				latest === undefined
					? undefined
					: versionDateLine(latest, i18n.language)
			}
			contentTestId="marketplace-detail-dialog"
			footer={
				<Button variant="secondary" onClick={() => props.onOpenChange(false)}>
					{t("common.close")}
				</Button>
			}
		>
			{plugin !== null && (
				<div className="flex flex-col gap-3">
					<p className="text-sm text-foreground">
						{resolveManifestDescription(plugin.manifest, i18n.language)}
					</p>
					<PluginPermissionBadges permissions={plugin.permissions} />
					{latest?.notes != null && (
						<div>
							<p className="mb-1 text-xs font-medium">
								{t("marketplace.notesTitle")}
							</p>
							<p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground">
								{latest.notes}
							</p>
						</div>
					)}
					<p className="flex items-center gap-2 text-xs text-muted-foreground">
						<ExternalLink
							href={marketRepoUrl(plugin.repo)}
							className="underline-offset-2 hover:underline"
						>
							@{plugin.repo}
						</ExternalLink>
						{latest !== undefined && (
							<ExternalLink
								href={latest.releaseUrl}
								className="underline-offset-2 hover:underline"
							>
								{t("marketplace.release")}
							</ExternalLink>
						)}
					</p>
				</div>
			)}
		</AppDialog>
	)
}

function MarketplaceInstallDialog(props: {
	readonly request: InstallTarget | null
	readonly onOpenChange: (open: boolean) => void
	readonly isPending: boolean
	readonly onConfirm: () => void
}) {
	const { t, i18n } = useTranslation()
	const target = props.request
	const versionLabel =
		target === null
			? undefined
			: target.mode === "update" && target.installedVersion !== undefined
				? `${target.installedVersion} → ${target.plugin.latest?.version ?? ""}`
				: target.plugin.latest?.version
	return (
		<ConfirmDialog
			open={target !== null}
			onOpenChange={props.onOpenChange}
			title={
				target?.mode === "update"
					? t("marketplace.updateConfirmTitle", {
							name:
								target !== null
									? resolveManifestName(target.plugin.manifest, i18n.language)
									: "",
						})
					: t("marketplace.installConfirmTitle")
			}
			confirmLabel={
				target?.mode === "update"
					? t("marketplace.update")
					: t("marketplace.install")
			}
			pendingLabel={t("marketplace.installing")}
			isPending={props.isPending}
			onConfirm={props.onConfirm}
			confirmTestId="marketplace-install-confirm"
			body={
				target !== null ? (
					<div className="flex flex-col gap-3">
						<div className="flex items-center gap-2.5">
							<PluginTileIcon
								iconRef={target.plugin.icon}
								pluginId={target.plugin.id}
								fallback={PlugCircle}
							/>
							<div className="flex flex-col gap-0.5">
								<span className="text-sm font-medium">
									{resolveManifestName(target.plugin.manifest, i18n.language)}
									{versionLabel !== undefined && versionLabel.length > 0 && (
										<span className="ml-2 text-xs font-normal text-muted-foreground">
											v{versionLabel}
										</span>
									)}
								</span>
								<span className="font-mono text-xs text-muted-foreground">
									@{target.plugin.repo}
								</span>
							</div>
						</div>
						<PluginPermissionBadges permissions={target.plugin.permissions} />
						<p className="text-xs leading-relaxed text-muted-foreground">
							{t("marketplace.installConfirmNote")}
						</p>
					</div>
				) : undefined
			}
		/>
	)
}

/**
 * List mode — catalog rows mirroring the plugins-page list anatomy:
 * icon + name + version line, permission marks, description, actions.
 */
function MarketplaceListRow(props: {
	readonly plugin: MarketPlugin
	readonly installed?: RouterOutputs["plugin"]["listAll"][number]
	readonly onInstall: () => void
	readonly onUpdate: () => void
	readonly onDetails: () => void
	readonly onUninstall: () => void
}) {
	const { t, i18n } = useTranslation()
	const { plugin, installed } = props
	const latest = plugin.state === "ok" ? plugin.latest : undefined
	const canInstall = latest?.assetUrl !== undefined
	const installedVersion = installed?.manifest.version
	const updateAvailable =
		installedVersion !== undefined &&
		latest !== undefined &&
		isNewer(latest.version, installedVersion)

	return (
		<div
			className="flex items-center gap-3 py-2.5"
			data-testid={`marketplace-plugin-${plugin.id}`}
		>
			<PluginTileIcon
				iconRef={plugin.icon}
				pluginId={plugin.id}
				fallback={PlugCircle}
			/>
			<div className="flex min-w-0 shrink-0 items-center gap-2">
				<span className="truncate text-ui font-medium">
					{resolveManifestName(plugin.manifest, i18n.language)}
				</span>
				<span className="shrink-0 font-mono text-tiny text-muted-foreground">
					{versionDateLine(latest, i18n.language)}
				</span>
				<span className="shrink-0 font-mono text-tiny text-muted-foreground">
					<ExternalLink
						href={marketRepoUrl(plugin.repo)}
						className="underline-offset-2 hover:underline"
					>
						@{plugin.repo}
					</ExternalLink>
				</span>
			</div>
			<PermissionMarks
				p={{
					id: plugin.id,
					permissions: plugin.permissions,
					manifest: plugin.manifest,
				}}
			/>
			<p className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
				{resolveManifestDescription(plugin.manifest, i18n.language)}
			</p>
			<div className="flex shrink-0 items-center gap-2">
				{plugin.state === "no_release" && (
					<span className="inline-flex h-6 shrink-0 items-center rounded-full bg-muted px-2 text-tiny text-muted-foreground">
						{t("marketplace.noRelease")}
					</span>
				)}
				{plugin.state === "error" && (
					<span
						className="max-w-40 truncate text-xs text-destructive"
						title={plugin.error}
					>
						{plugin.error}
					</span>
				)}
				{updateAvailable && (
					<Button
						size="sm"
						variant="secondary"
						onClick={props.onUpdate}
						disabled={!canInstall}
						data-testid={`marketplace-update-${plugin.id}`}
					>
						{t("marketplace.updateTo", { version: latest.version })}
					</Button>
				)}
				<Button
					size="sm"
					variant="secondary"
					onClick={props.onDetails}
					data-testid={`marketplace-details-${plugin.id}`}
				>
					{t("marketplace.details")}
				</Button>
				<Switch
					checked={installedVersion !== undefined}
					disabled={!canInstall}
					onCheckedChange={(checked) => {
						if (checked) props.onInstall()
						else props.onUninstall()
					}}
					aria-label={t("marketplace.installToggle")}
					data-testid={`marketplace-toggler-${plugin.id}`}
				/>
			</div>
		</div>
	)
}
