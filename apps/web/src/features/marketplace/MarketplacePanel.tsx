import { Button } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { Icon } from "@hoardodile/ui/components/icon"
import { toast } from "@hoardodile/ui/components/toast"
import { PlugCircle, Refresh } from "@hoardodile/ui/icons/registry"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "@/components/common/ExternalLink"
import { PluginTileIcon } from "@/features/plugin/icons/plugin-tile-icon"
import { PluginPermissionBadges } from "@/features/plugin/PluginPermissionBadges"
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

type InstallTarget = {
	readonly plugin: MarketPlugin
	readonly mode: "install" | "update"
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
	const [installTarget, setInstallTarget] = useState<InstallTarget | null>(null)

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

					{snapshotQuery.data?.plugins.length === 0 && (
						<p className="text-sm text-muted-foreground">
							{t("marketplace.emptyHint")}
						</p>
					)}

					<div
						className="flex flex-col gap-3"
						data-testid="marketplace-catalog"
					>
						{snapshotQuery.data?.plugins.map((plugin) => (
							<MarketplaceCard
								key={plugin.id}
								plugin={plugin}
								installed={installedById.get(plugin.id)}
								onInstall={() => setInstallTarget({ plugin, mode: "install" })}
								onUpdate={() => setInstallTarget({ plugin, mode: "update" })}
							/>
						))}
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
		</div>
	)
}

/** Registry repo address + save/disable. */
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
		<div className="flex flex-wrap items-end gap-2">
			<label className="flex min-w-64 flex-col gap-1">
				<span className="text-xs font-medium">
					{t("marketplace.registryRepoLabel")}
				</span>
				<input
					value={value}
					onChange={(e) => setValue(e.target.value)}
					placeholder={
						props.registryRepo ?? t("marketplace.registryPlaceholder")
					}
					className="h-9 rounded-md border border-input bg-transparent px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
					data-testid="marketplace-registry-input"
				/>
			</label>
			<Button
				onClick={() => saveMut.mutate({ registryRepo: value })}
				disabled={value.length === 0 || saveMut.isPending}
				data-testid="marketplace-registry-save"
			>
				{t("marketplace.save")}
			</Button>
			{props.registryRepo !== null && (
				<Button
					variant="secondary"
					onClick={() => {
						setValue("")
						saveMut.mutate({ registryRepo: null })
					}}
					disabled={saveMut.isPending}
					data-testid="marketplace-registry-disable"
				>
					{t("marketplace.disable")}
				</Button>
			)}
			<p className="w-full text-xs text-muted-foreground">
				{t("marketplace.setupHint")}
			</p>
		</div>
	)
}

function MarketplaceCard(props: {
	readonly plugin: MarketPlugin
	readonly installed?: RouterOutputs["plugin"]["listAll"][number]
	readonly onInstall: () => void
	readonly onUpdate: () => void
}) {
	const { t, i18n } = useTranslation()
	const { plugin, installed } = props
	const latest = plugin.state === "ok" ? plugin.latest : undefined
	const canInstall = latest?.assetUrl !== undefined
	const installedVersion = installed?.manifest.version

	const publishedLabel =
		latest?.publishedAt === null || latest?.publishedAt === undefined
			? undefined
			: new Date(latest.publishedAt).toLocaleDateString(i18n.language, {
					year: "numeric",
					month: "short",
					day: "numeric",
				})

	const action =
		installedVersion === undefined ? (
			<Button
				size="sm"
				onClick={props.onInstall}
				disabled={!canInstall}
				data-testid={`marketplace-install-${plugin.id}`}
			>
				{t("marketplace.install")}
			</Button>
		) : latest !== undefined && isNewer(latest.version, installedVersion) ? (
			<Button
				size="sm"
				onClick={props.onUpdate}
				disabled={!canInstall}
				data-testid={`marketplace-update-${plugin.id}`}
			>
				{t("marketplace.updateTo", { version: latest.version })}
			</Button>
		) : (
			<span className="inline-flex h-8 items-center rounded-md bg-muted px-2.5 text-xs text-muted-foreground">
				{t("marketplace.installed", { version: installedVersion })}
			</span>
		)

	return (
		<div
			className="rounded-lg border bg-card p-3"
			data-testid={`marketplace-plugin-${plugin.id}`}
		>
			<div className="flex items-start gap-3">
				<PluginTileIcon
					iconRef={plugin.icon}
					pluginId={plugin.id}
					fallback={PlugCircle}
				/>
				<div className="min-w-0 flex-1">
					<div className="flex items-center gap-2">
						<span className="truncate text-sm font-medium">{plugin.name}</span>
						<ExternalLink
							href={`https://github.com/${plugin.repo}`}
							className="shrink-0 text-xs text-muted-foreground underline-offset-2 hover:underline"
						>
							@{plugin.repo}
						</ExternalLink>
					</div>
					<p className="mt-0.5 line-clamp-2 text-xs text-muted-foreground">
						{plugin.description}
					</p>
					<PluginPermissionBadges
						permissions={plugin.permissions}
						className="mt-1.5"
					/>
				</div>
				<div className="flex shrink-0 flex-col items-end gap-1.5">
					{action}
					{plugin.state === "no_release" && (
						<span className="text-xs text-muted-foreground">
							{t("marketplace.noRelease")}
						</span>
					)}
					{plugin.state === "error" && (
						<span
							className="max-w-48 text-right text-xs text-destructive"
							title={plugin.error}
						>
							{plugin.error}
						</span>
					)}
					{latest !== undefined && (
						<span className="text-xs text-muted-foreground">
							v{latest.version}
							{publishedLabel !== undefined ? ` · ${publishedLabel}` : ""}
							{" · "}
							<ExternalLink
								href={latest.releaseUrl}
								className="underline-offset-2 hover:underline"
							>
								{t("marketplace.release")}
							</ExternalLink>
						</span>
					)}
				</div>
			</div>
			{latest?.notes !== null && latest?.notes !== undefined && (
				<p className="mt-2 line-clamp-3 whitespace-pre-wrap border-t pt-2 text-xs text-muted-foreground">
					{latest.notes}
				</p>
			)}
		</div>
	)
}

function MarketplaceInstallDialog(props: {
	readonly request: InstallTarget | null
	readonly onOpenChange: (open: boolean) => void
	readonly isPending: boolean
	readonly onConfirm: () => void
}) {
	const { t } = useTranslation()
	const target = props.request
	return (
		<ConfirmDialog
			open={target !== null}
			onOpenChange={props.onOpenChange}
			title={
				target?.mode === "update"
					? t("marketplace.updateConfirmTitle", {
							name: target.plugin.name,
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
									{target.plugin.name}
									{target.plugin.latest !== undefined && (
										<span className="ml-2 text-xs font-normal text-muted-foreground">
											v{target.plugin.latest.version}
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
