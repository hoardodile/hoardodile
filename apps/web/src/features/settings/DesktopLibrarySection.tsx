import type {
	DesktopShellConfig,
	HoardodileDesktopBridge,
} from "@hoardodile/shared/desktop"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Switch } from "@hoardodile/ui/components/switch"
import { Folder, FolderOpen, Restart } from "@hoardodile/ui/icons/registry"
import { useQueryClient } from "@tanstack/react-query"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { useConfirmDialog } from "@/components/common/useConfirmDialog"
import { importKeys } from "@/features/res/api"
import { getDesktopBridge } from "@/lib/desktop"
import { SettingsSection } from "./SettingsSection"
import { SectionDivider } from "./SettingsSheet"

/**
 * Desktop-only library folder, shared-folder import root, and shell
 * toggles. Changing the library relaunches. The shared-folder enable
 * switch live-patches the sidecar; the path can be chosen while the
 * switch is off. The shell does not copy or move files.
 */
export function DesktopLibrarySection() {
	const desktop = getDesktopBridge()
	const [config, setConfig] = useState<DesktopShellConfig | undefined>()

	useEffect(() => {
		if (desktop === undefined) return
		void desktop.getConfig().then(setConfig)
	}, [desktop])

	if (desktop === undefined || config === undefined) return null
	return (
		<DesktopLibraryForm
			desktop={desktop}
			config={config}
			onConfig={setConfig}
		/>
	)
}

function DesktopLibraryForm(props: {
	readonly desktop: HoardodileDesktopBridge
	readonly config: DesktopShellConfig
	readonly onConfig: (config: DesktopShellConfig) => void
}) {
	const { desktop, config, onConfig } = props
	const { t } = useTranslation()
	const queryClient = useQueryClient()
	const confirm = useConfirmDialog<string>()

	async function handlePickLibrary() {
		const next = await desktop.pickLibraryFolder()
		if (next === undefined || next === config.libraryPath) return
		confirm.open(next)
	}

	function handleConfirmChange() {
		const next = confirm.target
		if (next === undefined) return
		confirm.close()
		void desktop.changeLibraryFolder(next)
	}

	async function handlePickShared() {
		const next = await desktop.pickLibraryFolder()
		if (next === undefined || next === config.sharedFolderRoot) return
		try {
			await desktop.setSharedFolderRoot(next)
		} catch {
			return
		}
		onConfig({ ...config, sharedFolderRoot: next })
		await queryClient.invalidateQueries({ queryKey: importKeys.all })
	}

	async function handleSharedEnabled(enabled: boolean) {
		try {
			await desktop.setSharedFolderEnabled(enabled)
		} catch {
			return
		}
		onConfig({ ...config, sharedFolderEnabled: enabled })
		await queryClient.invalidateQueries({ queryKey: importKeys.all })
	}

	async function patch(
		partial: Partial<
			Pick<DesktopShellConfig, "autoStart" | "startInTray" | "autoUpdate">
		>,
	) {
		await desktop.setConfig(partial)
		onConfig({ ...config, ...partial })
	}

	return (
		<>
			<SettingsSection
				icon={Folder}
				title={t("me.desktop.library.title")}
				description={t("me.desktop.library.description")}
				layout="stack"
				data-testid="desktop-library-section"
			>
				<div className="flex flex-col gap-4">
					<DesktopPathRow
						path={config.libraryPath}
						pathTestId="desktop-library-path"
						changeTestId="desktop-library-change"
						changeLabel={t("me.desktop.library.change")}
						onChange={() => {
							void handlePickLibrary()
						}}
					/>
					<DesktopToggleRow
						title={t("me.desktop.autostart.title")}
						description={t("me.desktop.autostart.description")}
						checked={config.autoStart}
						onCheckedChange={(autoStart) => {
							void patch({ autoStart })
						}}
						testId="desktop-autostart"
					/>
					<DesktopToggleRow
						title={t("me.desktop.startInTray.title")}
						description={t("me.desktop.startInTray.description")}
						checked={config.startInTray}
						onCheckedChange={(startInTray) => {
							void patch({ startInTray })
						}}
						testId="desktop-start-in-tray"
					/>
					{config.portable ? null : (
						<DesktopToggleRow
							title={t("me.desktop.autoUpdate.title")}
							description={t("me.desktop.autoUpdate.description")}
							checked={config.autoUpdate}
							onCheckedChange={(autoUpdate) => {
								void patch({ autoUpdate })
							}}
							testId="desktop-auto-update"
						/>
					)}
				</div>
			</SettingsSection>
			<SectionDivider />
			<SettingsSection
				icon={FolderOpen}
				title={t("me.desktop.sharedFolder.title")}
				description={t("me.desktop.sharedFolder.description")}
				layout="stack"
				data-testid="desktop-shared-folder-section"
			>
				<div className="flex flex-col gap-4">
					<DesktopToggleRow
						title={t("me.desktop.sharedFolder.enable")}
						description={t("me.desktop.sharedFolder.enableDescription")}
						checked={config.sharedFolderEnabled}
						onCheckedChange={(enabled) => {
							void handleSharedEnabled(enabled)
						}}
						testId="desktop-shared-folder-enable"
					/>
					<DesktopPathRow
						path={config.sharedFolderRoot}
						pathTestId="desktop-shared-folder-path"
						changeTestId="desktop-shared-folder-change"
						changeLabel={t("me.desktop.library.change")}
						onChange={() => {
							void handlePickShared()
						}}
					/>
				</div>
			</SettingsSection>
			<SectionDivider />
			<ConfirmDialog
				open={confirm.isOpen}
				onOpenChange={confirm.onOpenChange}
				title={t("me.desktop.library.confirmTitle")}
				description={t("me.desktop.library.confirmDescription")}
				confirmLabel={t("me.desktop.library.change")}
				isPending={false}
				onConfirm={handleConfirmChange}
			/>
		</>
	)
}

function DesktopPathRow(props: {
	readonly path: string
	readonly pathTestId: string
	readonly changeTestId: string
	readonly changeLabel: string
	readonly onChange: () => void
}) {
	const { path, pathTestId, changeTestId, changeLabel, onChange } = props
	return (
		<div className="flex flex-wrap items-center justify-between gap-3">
			<p
				className="min-w-0 truncate text-ui text-foreground"
				title={path}
				data-testid={pathTestId}
			>
				{path}
			</p>
			<Button
				variant="secondary"
				className="shrink-0 [-webkit-app-region:no-drag]"
				onClick={onChange}
				data-testid={changeTestId}
			>
				<Icon icon={Restart} />
				{changeLabel}
			</Button>
		</div>
	)
}

function DesktopToggleRow(props: {
	readonly title: string
	readonly description: string
	readonly checked: boolean
	readonly onCheckedChange: (value: boolean) => void
	readonly testId: string
}) {
	const { title, description, checked, onCheckedChange, testId } = props
	return (
		<div className="flex items-center justify-between gap-6">
			<div className="min-w-0">
				<div className="text-ui font-semibold text-foreground">{title}</div>
				<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
					{description}
				</p>
			</div>
			<Switch
				checked={checked}
				onCheckedChange={onCheckedChange}
				aria-label={title}
				data-testid={testId}
				className="[-webkit-app-region:no-drag]"
			/>
		</div>
	)
}
