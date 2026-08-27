import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { Icon } from "@hoardodile/ui/components/icon"
import {
	IconToggle,
	type IconToggleOption,
} from "@hoardodile/ui/components/icon-toggle"
import { PillTabs } from "@hoardodile/ui/components/pill-tabs"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
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
import { PluginTileIcon } from "@/features/plugin/icons/plugin-tile-icon"
import {
	resolveManifestDescription,
	resolveManifestName,
} from "@/features/plugin/manifestText"
import { PluginPermissionBadges } from "@/features/plugin/PluginPermissionBadges"
import { PermissionMarks } from "@/features/plugin/PluginSettingsPanel"
import { PluginUninstallDialog } from "@/features/plugin/PluginUninstallDialog"
import {
	pluginKeys,
	pluginListAllQueryOptions,
} from "@/features/plugin/pluginApi"
import { errorMessage } from "@/lib/errors"
import { isNewer } from "@/lib/versions"
import { BundledPluginsSection } from "./BundledPluginsSection"
import { isMinAppSatisfied, marketUpdateAvailable } from "./compat"
import type { InstalledPlugin, MarketPlugin } from "./MarketplaceDetailDialog"
import {
	MarketplaceDetailDialog,
	versionDateLine,
} from "./MarketplaceDetailDialog"
import {
	marketplaceConfigQueryOptions,
	marketplaceInstall,
	marketplaceKeys,
	marketplaceRefreshMutation,
	marketplaceSnapshotQueryOptions,
} from "./marketplaceApi"

type MarketplaceView = "grid" | "list"

/** Catalog filter: everything, installed plugins, compatible updates. */
type MarketplaceFilter = "all" | "installed" | "updates"

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
 * GitHub release. The catalog fetches once on page open (no automatic
 * retries); the Refresh button in the header and the error state is the
 * manual retry. The registry address is configured from the page's action
 * bar (`MarketplacePageActions`), outside this section.
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
	const [filter, setFilter] = useState<MarketplaceFilter>("all")
	const [refreshConfirmOpen, setRefreshConfirmOpen] = useState(false)
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

	const plugins = (snapshotQuery.data?.plugins ?? []).filter((plugin) => {
		if (filter === "all") return true
		const installedVersion = installedById.get(plugin.id)?.manifest.version
		if (filter === "installed") return installedVersion !== undefined
		return marketUpdateAvailable(plugin, installedVersion)
	})

	const filterItems = [
		{ value: "all" as const, label: t("marketplace.filterAll") },
		{ value: "installed" as const, label: t("marketplace.filterInstalled") },
		{ value: "updates" as const, label: t("marketplace.filterUpdates") },
	]

	return (
		<div className="flex flex-col gap-4">
			{/* Official bundled plugins — offline restore lives here and must
			    work even when the registry is disabled, so it renders before
			    the catalog and independent of the registry config. */}
			<BundledPluginsSection />
			{registryRepo === null ? (
				<p className="text-sm text-muted-foreground">
					{t("marketplace.notConfiguredHint")}
				</p>
			) : snapshotQuery.isPending ? (
				<MarketplaceCatalogSkeleton />
			) : snapshotQuery.isError ? (
				<div className="flex flex-col items-start gap-3">
					<p className="text-sm text-destructive">
						{t("marketplace.loadFailed", {
							message: errorMessage(snapshotQuery.error, t("common.error")),
						})}
					</p>
					<Button
						variant="secondary"
						size="sm"
						onClick={() => setRefreshConfirmOpen(true)}
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
							<PillTabs<MarketplaceFilter>
								value={filter}
								onChange={setFilter}
								items={filterItems}
							/>
							<IconToggle
								options={viewOptions}
								value={view}
								onChange={setView}
							/>
							<Button
								variant="secondary"
								size="sm"
								onClick={() => setRefreshConfirmOpen(true)}
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

					{plugins.length === 0 &&
						(snapshotQuery.data?.plugins.length ?? 0) > 0 && (
							<p className="text-sm text-muted-foreground">
								{t("marketplace.emptyFilterHint")}
							</p>
						)}
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
						{plugins.map((plugin) =>
							view === "grid" ? (
								<MarketplaceCard
									key={plugin.id}
									plugin={plugin}
									installed={installedById.get(plugin.id)}
									onDetails={() => setDetailTarget(plugin)}
								/>
							) : (
								<MarketplaceListRow
									key={plugin.id}
									plugin={plugin}
									installed={installedById.get(plugin.id)}
									onDetails={() => setDetailTarget(plugin)}
								/>
							),
						)}
					</div>
				</>
			)}

			<ConfirmDialog
				open={refreshConfirmOpen}
				onOpenChange={setRefreshConfirmOpen}
				title={t("marketplace.refreshConfirmTitle")}
				description={t("marketplace.refreshConfirmDescription")}
				confirmLabel={t("marketplace.refresh")}
				pendingLabel={t("common.working")}
				isPending={refreshMut.isPending}
				onConfirm={() => {
					setRefreshConfirmOpen(false)
					refreshMut.mutate()
				}}
				confirmTestId="marketplace-refresh-confirm"
			/>

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
			{detailTarget !== null && (
				<MarketplaceDetailDialog
					open
					plugin={detailTarget}
					installed={installedById.get(detailTarget.id)}
					onOpenChange={(open) => {
						if (!open) setDetailTarget(null)
					}}
					onInstall={() => {
						setInstallTarget({ plugin: detailTarget, mode: "install" })
						setDetailTarget(null)
					}}
					onUpdate={() => {
						setInstallTarget({
							plugin: detailTarget,
							mode: "update",
							installedVersion: installedById.get(detailTarget.id)?.manifest
								.version,
						})
						setDetailTarget(null)
					}}
					onUninstall={() => setUninstallTarget(detailTarget)}
				/>
			)}
			{uninstallTarget !== null && (
				<PluginUninstallDialog
					pluginId={uninstallTarget.id}
					pluginName={resolveManifestName(
						uninstallTarget.manifest,
						i18n.language,
					)}
					open
					onOpenChange={(open) => {
						if (!open) setUninstallTarget(null)
					}}
				/>
			)}
		</div>
	)
}

/** Loading placeholder — skeleton cards mirroring the grid anatomy. */
function MarketplaceCatalogSkeleton() {
	return (
		<div
			className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3"
			data-testid="marketplace-catalog-skeleton"
			aria-hidden
		>
			{Array.from({ length: 6 }, (_, index) => (
				<div
					key={index}
					className="flex flex-col gap-2.5 rounded-xl border border-border p-4"
				>
					<div className="flex items-center gap-2.5">
						<Skeleton className="size-9 shrink-0 rounded-lg" />
						<div className="min-w-0 flex-1">
							<Skeleton className="mb-1.5 h-4 w-2/3" />
							<Skeleton className="h-3 w-1/3" />
						</div>
					</div>
					<Skeleton className="h-3 w-full" />
					<Skeleton className="h-3 w-4/5" />
					<div className="flex items-center justify-between">
						<Skeleton className="h-3 w-16" />
						<Skeleton className="h-7 w-16 rounded-md" />
					</div>
				</div>
			))}
		</div>
	)
}

/** Friendly short line for an error entry (rate limits get user-friendly
    copy; the raw message never changes for anything else). */
function errorLineFor(
	plugin: MarketPlugin,
	t: (key: string) => string,
): string {
	if (plugin.errorKind === "rate_limited" || plugin.rateLimited === true) {
		return t("marketplace.errorRateLimitedShort")
	}
	return plugin.error ?? ""
}

/** The version-requirement chip — shown when installs/updates are gated
    by the host app version, so a hidden action is never a mystery. */
function RequiresChip(props: { readonly plugin: MarketPlugin }) {
	const { t } = useTranslation()
	return (
		<span className="inline-flex h-6 shrink-0 items-center rounded-full bg-muted px-2 text-tiny text-muted-foreground">
			{t("marketplace.requiresAppVersion", {
				version: props.plugin.manifest.minAppVersion ?? "",
			})}
		</span>
	)
}

function MarketplaceCard(props: {
	readonly plugin: MarketPlugin
	readonly installed?: InstalledPlugin
	readonly onDetails: () => void
}) {
	const { t, i18n } = useTranslation()
	const { plugin, installed } = props
	const latest = plugin.state === "ok" ? plugin.latest : undefined
	const installedVersion = installed?.manifest.version
	const compatible = isMinAppSatisfied(plugin.manifest)
	const rawUpdate =
		installedVersion !== undefined &&
		latest !== undefined &&
		isNewer(latest.version, installedVersion)
	const requiresShown =
		!compatible && (installedVersion === undefined || rawUpdate)

	return (
		<div
			className="relative flex flex-col gap-2.5 overflow-hidden rounded-xl border border-border p-4 transition-colors hover:bg-accent/40"
			data-testid={`marketplace-plugin-${plugin.id}`}
		>
			{installedVersion !== undefined && (
				<span
					className="pointer-events-none absolute inset-x-0 top-0 flex h-3 items-center justify-center bg-foreground text-tiny font-semibold text-background"
					data-testid={`marketplace-installed-banner-${plugin.id}`}
				>
					{t("marketplace.installedBadge")}
				</span>
			)}
			{(plugin.state === "error" || plugin.rateLimited === true) && (
				<span
					className="pointer-events-none absolute inset-x-0 bottom-0 flex h-3 items-center overflow-hidden bg-muted text-tiny text-destructive"
					data-testid={`marketplace-card-error-${plugin.id}`}
				>
					<span className="market-ticker-track" aria-hidden>
						{[0, 1].map((copy) => (
							<span
								key={copy}
								className="flex shrink-0 items-center"
								title={plugin.error}
							>
								<span className="whitespace-nowrap px-3">
									{errorLineFor(plugin, t)}
								</span>
							</span>
						))}
					</span>
				</span>
			)}
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
					{requiresShown && <RequiresChip plugin={plugin} />}
					<Button
						size="sm"
						variant="secondary"
						onClick={props.onDetails}
						data-testid={`marketplace-view-${plugin.id}`}
					>
						{t("marketplace.view")}
					</Button>
				</div>
			</div>
		</div>
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
 * The repo link lives in the detail dialog only; the row stays compact.
 */
function MarketplaceListRow(props: {
	readonly plugin: MarketPlugin
	readonly installed?: InstalledPlugin
	readonly onDetails: () => void
}) {
	const { t, i18n } = useTranslation()
	const { plugin, installed } = props
	const latest = plugin.state === "ok" ? plugin.latest : undefined
	const installedVersion = installed?.manifest.version
	const compatible = isMinAppSatisfied(plugin.manifest)
	const rawUpdate =
		installedVersion !== undefined &&
		latest !== undefined &&
		isNewer(latest.version, installedVersion)
	const requiresShown =
		!compatible && (installedVersion === undefined || rawUpdate)

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
				{requiresShown && <RequiresChip plugin={plugin} />}
				{installedVersion !== undefined && (
					<span className="inline-flex h-6 shrink-0 items-center rounded-full bg-muted px-2 text-tiny text-muted-foreground">
						{t("marketplace.installedBadge")}
					</span>
				)}
				<Button
					size="sm"
					variant="secondary"
					onClick={props.onDetails}
					data-testid={`marketplace-view-${plugin.id}`}
				>
					{t("marketplace.view")}
				</Button>
			</div>
		</div>
	)
}
