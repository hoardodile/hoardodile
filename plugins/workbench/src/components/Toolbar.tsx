import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Icon } from "@hoardodile/ui/components/icon"
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@hoardodile/ui/components/popover"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@hoardodile/ui/components/tooltip"
import { Box, Refresh } from "@hoardodile/ui/icons/registry"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { WorkbenchConfig } from "../config.ts"
import type {
	ResourceContext,
	WorkbenchManifest,
	WorkbenchResource,
} from "../context.ts"
import { ConfigPopover, type PluginStateView } from "./ConfigPopover.tsx"
import { type FullscreenAPI, FullscreenButton } from "./FullscreenButton.tsx"
import { InfoPopover } from "./InfoPopover.tsx"
import { ResCardPreview } from "./ResCardPreview.tsx"

/**
 * The chrome strip: hairline on the canvas, controls right-aligned and
 * muted (DESIGN.md — Metadata is quiet). The plugin label keeps the id
 * `scripts/smoke.mjs` reads (#plugin-name); the hook status and the rest
 * of the metadata live in the InfoPopover (#hook-status) so the bar stays
 * lean on narrow screens.
 */
export function Toolbar(props: {
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
	const { manifest, resources, resource, ctx, config, fullscreen, locale } =
		props
	const { t: tw } = useTranslation("workbench")

	return (
		<header className="flex h-nav shrink-0 items-center gap-3 border-b border-border px-4">
			<span
				id="plugin-name"
				className="min-w-0 truncate text-ui text-secondary-foreground"
			>
				{manifest === null ? "…" : `${manifest.name} (${manifest.id})`}
			</span>
			{resource !== undefined && resources.length >= 2 ? (
				<ResourcePicker
					resource={resource}
					resources={resources}
					onSelect={props.onSelect}
					className="ml-1"
				/>
			) : null}
			<span className="min-w-0 flex-1" />
			<span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
				{tw(`mode.${config.mode}`)}
			</span>
			<Tooltip>
				<TooltipTrigger
					render={
						<Button
							variant="ghost"
							size="icon-sm"
							aria-label={tw("toolbar.reloadAria")}
							onClick={props.onReload}
						>
							<Icon icon={Refresh} />
						</Button>
					}
				/>
				<TooltipContent>{tw("toolbar.reloadHint")}</TooltipContent>
			</Tooltip>
			<FullscreenButton api={fullscreen} />
			<CardPreviewPopover
				manifest={manifest}
				resource={resource}
				ctx={ctx}
				locale={locale}
			/>
			<InfoPopover
				manifest={manifest}
				resource={resource}
				ctx={ctx}
				mode={config.mode}
			/>
			<ConfigPopover
				config={config}
				onChange={props.onConfigChange}
				pluginState={props.pluginState}
				disabled={manifest === null}
				cacheDisabled={manifest === null || resource === undefined}
				onResetSettings={props.onResetSettings}
				onClearCache={props.onClearCache}
				onRestoreState={props.onRestoreState}
			/>
		</header>
	)
}

/**
 * Resource selector with the rendered cover thumbnail, mirroring the
 * app's `GET /api/resources/:id/cover` route; a 404 (no cover source or
 * the render pipeline is unavailable) hides the thumbnail via the
 * image's error handler — the old workbench page's behavior.
 */
function ResourcePicker(props: {
	readonly resource: WorkbenchResource
	readonly resources: readonly WorkbenchResource[]
	readonly onSelect: (resId: string) => void
	readonly className?: string
}) {
	const { resource, resources, onSelect } = props
	const { t: tw } = useTranslation("workbench")
	const [coverFailed, setCoverFailed] = useState(false)

	// A fresh element per resource: an error from the previous id must
	// never hide the next resource's cover.
	const coverSrc = `/api/resources/${encodeURIComponent(resource.id)}/cover`
	useEffect(() => {
		setCoverFailed(false)
	}, [coverSrc])

	return (
		<span className={props.className}>
			<span className="flex h-chip items-center gap-1.5">
				{!coverFailed ? (
					<img
						key={coverSrc}
						src={coverSrc}
						alt=""
						referrerPolicy="no-referrer"
						className="size-7 rounded-md object-cover"
						onError={() => setCoverFailed(true)}
					/>
				) : null}
				<DropdownSelect
					value={resource.id}
					onValueChange={onSelect}
					options={resources.map((r) => ({ value: r.id, label: r.name }))}
					aria-label={tw("toolbar.resource")}
					triggerClassName="max-w-40 md:max-w-64"
				/>
			</span>
		</span>
	)
}

/**
 * Top-right icon button that opens a popover simulating the resource's
 * res card — real generated cover + the plugin's manifest card templates
 * + the hook snapshot metadata — so the dev can walk the metadata → cover
 * → card pipeline offline. Hidden until the manifest, resource and hook
 * snapshot are all available.
 */
function CardPreviewPopover(props: {
	readonly manifest: WorkbenchManifest | null
	readonly resource: WorkbenchResource | undefined
	readonly ctx: ResourceContext | null
	readonly locale: string
}) {
	const { manifest, resource, ctx, locale } = props
	const { t: tw } = useTranslation("workbench")
	if (manifest === null || resource === undefined || ctx === null) return null

	return (
		<Popover closeOnBlur>
			<Tooltip>
				<TooltipTrigger
					render={
						<PopoverTrigger
							render={
								<Button
									variant="ghost"
									size="icon-sm"
									aria-label={tw("toolbar.cardPreviewAria")}
									data-testid="workbench-card-preview"
								>
									<Icon icon={Box} />
								</Button>
							}
						/>
					}
				/>
				<TooltipContent>{tw("toolbar.cardPreviewHint")}</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
				<PopoverHeader>
					<PopoverTitle>{tw("popover.cardPreviewTitle")}</PopoverTitle>
					<PopoverDescription>
						{tw("popover.cardPreviewDescription")}
					</PopoverDescription>
				</PopoverHeader>
				<ResCardPreview
					manifest={manifest}
					resource={resource}
					snapshot={ctx.snapshot}
					locale={locale}
				/>
			</PopoverContent>
		</Popover>
	)
}
