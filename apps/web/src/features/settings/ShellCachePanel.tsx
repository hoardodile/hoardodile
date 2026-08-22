import type { HoardodileDesktopBridge } from "@hoardodile/shared/desktop"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { toast } from "@hoardodile/ui/components/toast"
import { Eraser } from "@hoardodile/ui/icons/registry"
import { useCallback, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { useConfirmDialog } from "@/components/common/useConfirmDialog"
import { getDesktopBridge } from "@/lib/desktop"
import { formatBytes } from "@/lib/formatBytes"
import { SettingsSection } from "./SettingsSection"

/**
 * Desktop-only shell cache row: the Chromium session caches of the app
 * window (HTTP responses, compiled code, shader caches) plus the updater
 * download cache. Clearing never touches cookies, localStorage or
 * IndexedDB — those are user data. A downloaded update that is ready to
 * install keeps its installer.
 */
export function ShellCachePanel() {
	const desktop = getDesktopBridge()
	if (desktop === undefined) return null
	return <ShellCacheForm desktop={desktop} />
}

function ShellCacheForm(props: { readonly desktop: HoardodileDesktopBridge }) {
	const { desktop } = props
	const { t } = useTranslation()
	const confirm = useConfirmDialog<true>()
	const [size, setSize] = useState<number | undefined>(undefined)
	const [clearing, setClearing] = useState(false)

	const refresh = useCallback(async () => {
		try {
			setSize(await desktop.getShellCacheSize())
		} catch {
			setSize(undefined)
		}
	}, [desktop])

	useEffect(() => {
		void refresh()
	}, [refresh])

	async function handleConfirm() {
		setClearing(true)
		try {
			const freed = await desktop.clearShellCache()
			toast.add({
				title: t("me.desktop.shellCache.toastCleared", {
					bytes: formatBytes(freed),
				}),
				type: "info",
			})
		} catch {
			toast.add({
				title: t("me.desktop.shellCache.clearFailed"),
				type: "error",
			})
		} finally {
			setClearing(false)
			await refresh()
		}
	}

	return (
		<>
			<SettingsSection
				icon={Eraser}
				title={t("me.desktop.shellCache.title")}
				description={t("me.desktop.shellCache.description")}
				layout="compact"
				data-testid="desktop-shell-cache-section"
			>
				<div className="flex flex-wrap items-center gap-3">
					<span
						className="text-ui text-foreground tabular-nums"
						data-testid="desktop-shell-cache-size"
					>
						{size === undefined
							? t("me.desktop.shellCache.unavailable")
							: t("me.desktop.shellCache.currentSize", {
									size: formatBytes(size),
								})}
					</span>
					<Button
						variant="secondary"
						onClick={() => confirm.open(true)}
						disabled={clearing || size === undefined}
						data-testid="desktop-shell-cache-clear"
					>
						<Icon icon={Eraser} />
						{t("me.desktop.shellCache.clear")}
					</Button>
				</div>
			</SettingsSection>

			<ConfirmDialog
				open={confirm.isOpen}
				onOpenChange={confirm.onOpenChange}
				title={t("me.desktop.shellCache.confirmTitle")}
				description={t("me.desktop.shellCache.confirmDescription")}
				confirmLabel={t("me.desktop.shellCache.clear")}
				pendingLabel={t("me.desktop.shellCache.clearing")}
				isPending={clearing}
				destructive
				onConfirm={() => {
					void handleConfirm()
				}}
			/>
		</>
	)
}
