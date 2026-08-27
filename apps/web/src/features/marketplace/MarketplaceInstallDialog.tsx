import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { toast } from "@hoardodile/ui/components/toast"
import { PlugCircle } from "@hoardodile/ui/icons/registry"
import { useMutation, useQueryClient } from "@tanstack/react-query"
import { useTranslation } from "react-i18next"
import { PluginTileIcon } from "@/features/plugin/icons/plugin-tile-icon"
import { resolveManifestName } from "@/features/plugin/manifestText"
import { PluginPermissionBadges } from "@/features/plugin/PluginPermissionBadges"
import { pluginKeys } from "@/features/plugin/pluginApi"
import { errorMessage } from "@/lib/errors"
import type { MarketPlugin } from "./MarketplaceDetailDialog"
import { marketplaceInstall } from "./marketplaceApi"

export type InstallTarget = {
	readonly plugin: MarketPlugin
	readonly mode: "install" | "update"
	/** Installed version before an update — shown as the version arrow. */
	readonly installedVersion?: string
}

/**
 * The install/update confirmation shared by the marketplace page and the
 * plugins page's detail dialog: the plugin identity, the declared
 * permissions and the trust note, then the download + install.
 */
export function MarketplaceInstallDialog(props: {
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
 * The download mutation the install/update confirmation drives — shared by
 * the marketplace catalog and the plugins page (both report the same
 * toasts and invalidate the same plugin queries on success). The caller
 * hooks `onSuccess` to close its own confirm dialog.
 */
export function useMarketplaceInstall(
	onSuccess?: (target: InstallTarget) => void,
) {
	const { t } = useTranslation()
	const qc = useQueryClient()
	return useMutation({
		mutationFn: (target: InstallTarget) =>
			marketplaceInstall({
				id: target.plugin.id,
				repo: target.plugin.repo,
				assetUrl: target.plugin.latest?.assetUrl ?? "",
				sha256: target.plugin.latest?.sha256,
			}),
		onSuccess: (_result, target) => {
			onSuccess?.(target)
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
}
