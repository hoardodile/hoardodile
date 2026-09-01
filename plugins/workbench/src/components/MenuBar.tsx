import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@hoardodile/ui/components/tooltip"
import {
	Box,
	InfoCircle,
	Maximize,
	Minimize,
	Refresh,
	Settings,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
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
 * The workbench title bar: the resource picker on the left and, on the
 * right, text buttons for the resource card and iframe settings plus icon
 * buttons for plugin info, reload and fullscreen. The three detail
 * surfaces open as dialogs so the chrome stays lean.
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
	readonly onConfigChange: (patch: Partial<WorkbenchConfig>) => void
	readonly onSelect: (resId: string) => void
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
		onConfigChange,
		onSelect,
		onReload,
		onResetSettings,
		onClearCache,
		onRestoreState,
	} = props
	const { t: tw } = useTranslation("workbench")
	const [dialog, setDialog] = useState<DialogKind | null>(null)
	const closeDialog = () => setDialog(null)
	const cardReady = manifest !== null && resource !== undefined && ctx !== null

	return (
		<>
			<header className="flex h-nav shrink-0 items-center gap-2 border-b border-border px-2">
				<Button
					variant="ghost"
					size="sm"
					data-testid="workbench-settings"
					onClick={() => setDialog("settings")}
				>
					<Icon icon={Settings} />
					{tw("toolbar.settings")}
				</Button>
				<Button
					variant="ghost"
					size="sm"
					disabled={!cardReady}
					data-testid="workbench-card"
					onClick={() => setDialog("card")}
				>
					<Icon icon={Box} />
					{tw("toolbar.card")}
				</Button>
				{resource !== undefined && resources.length >= 2 ? (
					<ResourceChipList
						resource={resource}
						resources={resources}
						onSelect={onSelect}
					/>
				) : null}

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

/**
 * Narrow-layout resource selector: a single-line horizontal chip row
 * (below the `sidebar` breakpoint, where the resource list collapses out
 * of the stage). Wide layout uses the sidebar's {@link ResourceList} in
 * `App` instead. A chip row keeps the one-line toolbar height; many
 * resources scroll horizontally rather than wrapping.
 */
function ResourceChipList(props: {
	readonly resource: WorkbenchResource
	readonly resources: readonly WorkbenchResource[]
	readonly onSelect: (resId: string) => void
}) {
	const { resource, resources, onSelect } = props
	const { t: tw } = useTranslation("workbench")
	return (
		<nav
			data-testid="workbench-resource-chips"
			aria-label={tw("toolbar.resource")}
			className="hidden max-w-64 items-center gap-1 overflow-x-auto max-sidebar:flex"
		>
			{resources.map((r) => {
				const selected = r.id === resource.id
				return (
					<button
						key={r.id}
						type="button"
						data-testid="workbench-resource-chip"
						data-resource-id={r.id}
						aria-pressed={selected}
						onClick={() => onSelect(r.id)}
						className={cn(
							"h-control shrink-0 rounded-full px-3 text-xs whitespace-nowrap",
							selected
								? "bg-muted text-foreground"
								: "text-secondary-foreground hover:bg-muted",
						)}
					>
						{r.name}
					</button>
				)
			})}
		</nav>
	)
}
