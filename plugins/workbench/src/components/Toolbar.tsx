import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Icon } from "@hoardodile/ui/components/icon"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@hoardodile/ui/components/tooltip"
import { Refresh } from "@hoardodile/ui/icons/registry"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import type { WorkbenchConfig } from "../config.ts"
import type { WorkbenchManifest, WorkbenchResource } from "../context.ts"
import { ConfigPopover } from "./ConfigPopover.tsx"

/**
 * The chrome strip: hairline on the canvas, metadata right-aligned and
 * muted (DESIGN.md — Metadata is quiet). The plugin label and the status
 * line keep the ids `scripts/smoke.mjs` reads (#plugin-name,
 * #hook-status), so the end-to-end test is unchanged.
 */
export function Toolbar(props: {
	readonly manifest: WorkbenchManifest | null
	readonly resources: readonly WorkbenchResource[]
	readonly resource: WorkbenchResource | undefined
	readonly status: string
	readonly viewportLabel: string
	readonly config: WorkbenchConfig
	readonly onConfigChange: (patch: Partial<WorkbenchConfig>) => void
	readonly onSelect: (resId: string) => void
	readonly onReload: () => void
}) {
	const { manifest, resources, resource, status, viewportLabel, config } = props
	const { t: tw } = useTranslation("workbench")

	return (
		<header className="flex h-nav shrink-0 items-center gap-3 border-b border-border px-4">
			<span className="text-ui text-muted-foreground">
				{tw("toolbar.plugin")}
			</span>
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
			<span
				id="hook-status"
				className="min-w-0 truncate text-xs text-muted-foreground"
			>
				{status}
			</span>
			<span className="shrink-0 text-xs whitespace-nowrap text-muted-foreground">
				{viewportLabel}
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
			<ConfigPopover config={config} onChange={props.onConfigChange} />
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
					triggerClassName="max-w-64"
				/>
			</span>
		</span>
	)
}
