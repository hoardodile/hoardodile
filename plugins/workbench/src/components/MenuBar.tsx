import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@hoardodile/ui/components/tooltip"
import { useBelowSidebar } from "@hoardodile/ui/hooks/use-mobile"
import {
	Box,
	Gallery,
	InfoCircle,
	Maximize,
	Minimize,
	Refresh,
	Settings,
} from "@hoardodile/ui/icons/registry"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import type { WorkbenchConfig } from "../config.ts"
import type {
	ResourceContext,
	WorkbenchManifest,
	WorkbenchResource,
} from "../context.ts"
import { CardPreviewDialog } from "./CardPreviewDialog.tsx"
import { ConfigDialog, type PluginStateView } from "./ConfigDialog.tsx"
import type { FullscreenAPI } from "./FullscreenButton.tsx"
import { InfoDialog } from "./InfoDialog.tsx"

type DialogKind = "card" | "settings" | "info"

/**
 * The workbench title bar: on the left, a Resources drawer toggle (shown
 * only below the sidebar breakpoint, where the resource sidebar is a
 * drawer — at wide widths the sidebar is always docked and needs no
 * toggle) plus text buttons for the iframe settings and the resource card;
 * on the right, icon buttons for plugin info, reload and fullscreen. The
 * three detail surfaces open as dialogs so the chrome stays lean. Below
 * the sidebar breakpoint the button text collapses away (icon-only bars).
 */
export function MenuBar(props: {
	readonly manifest: WorkbenchManifest | null
	readonly resources: readonly WorkbenchResource[]
	readonly resource: WorkbenchResource | undefined
	readonly ctx: ResourceContext | null
	readonly config: WorkbenchConfig
	readonly pluginState: PluginStateView
	readonly fullscreen: FullscreenAPI
	readonly locale: string
	readonly resourcesOpen: boolean
	readonly onConfigChange: (patch: Partial<WorkbenchConfig>) => void
	readonly onToggleResources: () => void
	readonly onReload: () => void
	readonly onResetSettings: () => void
	readonly onClearCache: () => void
	readonly onRestoreState: () => void
}) {
	const {
		manifest,
		resources,
		resource,
		ctx,
		config,
		pluginState,
		fullscreen,
		locale,
		resourcesOpen,
		onConfigChange,
		onToggleResources,
		onReload,
		onResetSettings,
		onClearCache,
		onRestoreState,
	} = props
	const { t: tw } = useTranslation("workbench")
	const [dialog, setDialog] = useState<DialogKind | null>(null)
	const closeDialog = () => setDialog(null)
	const cardReady = manifest !== null && resource !== undefined && ctx !== null
	const belowSidebar = useBelowSidebar()

	return (
		<>
			<header className="flex h-nav shrink-0 items-center gap-2 border-b border-border px-2">
				{belowSidebar && resources.length >= 2 ? (
					<Tooltip>
						<TooltipTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={tw("toolbar.resourcesAria")}
									data-testid="workbench-resources"
									aria-expanded={resourcesOpen}
									onClick={onToggleResources}
								>
									<Icon icon={Gallery} />
								</Button>
							}
						/>
						<TooltipContent>{tw("toolbar.resources")}</TooltipContent>
					</Tooltip>
				) : null}
				<Button
					variant="ghost"
					size="sm"
					data-testid="workbench-settings"
					onClick={() => setDialog("settings")}
				>
					<Icon icon={Settings} />
					<span className="max-sidebar:hidden">{tw("toolbar.settings")}</span>
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={!cardReady}
					data-testid="workbench-card"
					onClick={() => setDialog("card")}
				>
					<Icon icon={Box} />
					<span className="max-sidebar:hidden">{tw("toolbar.card")}</span>
				</Button>

				<span className="min-w-0 flex-1" />

				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={tw("toolbar.info")}
								data-testid="workbench-info"
								onClick={() => setDialog("info")}
							>
								<Icon icon={InfoCircle} />
							</Button>
						}
					/>
					<TooltipContent>{tw("toolbar.info")}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={tw("toolbar.reloadAria")}
								data-testid="workbench-reload"
								onClick={onReload}
							>
								<Icon icon={Refresh} />
							</Button>
						}
					/>
					<TooltipContent>{tw("toolbar.reloadHint")}</TooltipContent>
				</Tooltip>
				<Tooltip>
					<TooltipTrigger
						render={
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={tw(
									fullscreen.isFullscreen
										? "toolbar.exitFullscreen"
										: "toolbar.enterFullscreen",
								)}
								data-testid="workbench-fullscreen"
								onClick={fullscreen.toggle}
							>
								<Icon icon={fullscreen.isFullscreen ? Minimize : Maximize} />
							</Button>
						}
					/>
					<TooltipContent>
						{tw(
							fullscreen.isFullscreen
								? "toolbar.exitFullscreen"
								: "toolbar.enterFullscreen",
						)}
					</TooltipContent>
				</Tooltip>
			</header>

			<InfoDialog
				open={dialog === "info"}
				onOpenChange={(open) => {
					if (!open) closeDialog()
				}}
				manifest={manifest}
				resource={resource}
				ctx={ctx}
				mode={config.mode}
			/>
			<ConfigDialog
				open={dialog === "settings"}
				onOpenChange={(open) => {
					if (!open) closeDialog()
				}}
				config={config}
				onChange={onConfigChange}
				pluginState={pluginState}
				disabled={manifest === null}
				cacheDisabled={manifest === null || resource === undefined}
				onResetSettings={onResetSettings}
				onClearCache={onClearCache}
				onRestoreState={onRestoreState}
			/>
			<CardPreviewDialog
				open={dialog === "card"}
				onOpenChange={(open) => {
					if (!open) closeDialog()
				}}
				manifest={manifest}
				resource={resource}
				ctx={ctx}
				locale={locale}
			/>
		</>
	)
}
