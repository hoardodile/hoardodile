import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import {
	Popover,
	PopoverContent,
	PopoverDescription,
	PopoverHeader,
	PopoverTitle,
	PopoverTrigger,
} from "@hoardodile/ui/components/popover"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { Separator } from "@hoardodile/ui/components/separator"
import {
	Tooltip,
	TooltipContent,
	TooltipTrigger,
} from "@hoardodile/ui/components/tooltip"
import { InfoCircle } from "@hoardodile/ui/icons/registry"
import { useTranslation } from "react-i18next"
import type { WorkbenchPresentationMode } from "../config.ts"
import {
	describeContext,
	type ResourceContext,
	type WorkbenchManifest,
	type WorkbenchResource,
} from "../context.ts"

/**
 * The read-only info popover: a single place for every workbench detail —
 * the mounted plugin, the selected resource, the hook snapshot summary and
 * the render capabilities, plus the current presentation mode. Mirrors the
 * `ConfigPopover` shell (header + section labels) so the two controls read
 * as one family; note `#hook-status` lives here (the toolbar smoke test
 * opens this popover to read it).
 */
export function InfoPopover(props: {
	readonly manifest: WorkbenchManifest | null
	readonly resource: WorkbenchResource | undefined
	readonly ctx: ResourceContext | null
	readonly mode: WorkbenchPresentationMode
}) {
	const { manifest, resource, ctx, mode } = props
	const { t: tw } = useTranslation("workbench")
	const snap = ctx?.snapshot ?? null
	const status = ctx === null ? tw("app.loading") : describeContext(ctx)
	const yesno = (value: boolean) => tw(value ? "popover.yes" : "popover.no")
	// Presence is unknown when there is no captured snapshot, so these read
	// "—" instead of a misleading "no".
	const present = (value: boolean) => (snap === null ? "—" : yesno(value))
	const detectValue =
		snap === null
			? "—"
			: snap.detect.ok
				? tw("popover.ok")
				: snap.detect.reasons?.length
					? `${tw("popover.miss")} (${snap.detect.reasons.join(", ")})`
					: tw("popover.miss")
	const fileCountValue =
		snap === null
			? "—"
			: String(snap.files?.length ?? snap.fileStats.count ?? 0)
	const hashValue =
		snap === null
			? "—"
			: snap.imageHashes === undefined
				? tw("popover.no")
				: String(snap.imageHashes.length)
	const errorsValue =
		snap === null
			? "—"
			: Object.keys(snap.errors).length === 0
				? tw("popover.none")
				: Object.keys(snap.errors).join(", ")

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
									aria-label={tw("popover.infoAria")}
									data-testid="workbench-info"
								>
									<Icon icon={InfoCircle} />
								</Button>
							}
						/>
					}
				/>
				<TooltipContent>{tw("popover.infoTooltip")}</TooltipContent>
			</Tooltip>
			<PopoverContent align="end" className="w-80 max-w-[calc(100vw-2rem)]">
				<PopoverHeader>
					<PopoverTitle>{tw("popover.infoTitle")}</PopoverTitle>
					<PopoverDescription>
						{tw("popover.infoDescription")}
					</PopoverDescription>
				</PopoverHeader>

				<SectionLabel>{tw("popover.sectionPlugin")}</SectionLabel>
				<div className="flex flex-col gap-1.5">
					<InfoRow
						label={tw("popover.pluginName")}
						value={manifest?.name ?? "—"}
					/>
					<InfoRow label={tw("popover.pluginId")} value={manifest?.id ?? "—"} />
					<InfoRow
						label={tw("popover.permissionDownload")}
						value={tw(
							manifest?.permissions?.download ? "popover.yes" : "popover.no",
						)}
					/>
				</div>

				<Separator />

				<SectionLabel>{tw("popover.sectionResource")}</SectionLabel>
				<div className="flex flex-col gap-1.5">
					<InfoRow
						label={tw("popover.resourceName")}
						value={resource?.name ?? "—"}
					/>
					<InfoRow
						label={tw("popover.resourceId")}
						value={resource?.id ?? "—"}
					/>
					{resource?.contentPluginId !== undefined ? (
						<InfoRow
							label={tw("popover.contentPlugin")}
							value={resource.contentPluginId}
						/>
					) : null}
				</div>

				<Separator />

				<SectionLabel>{tw("popover.sectionHook")}</SectionLabel>
				<span id="hook-status" className="block text-xs text-foreground">
					{status}
				</span>
				<div className="mt-1.5 flex flex-col gap-1.5">
					<InfoRow label={tw("popover.hookDetect")} value={detectValue} />
					<InfoRow label={tw("popover.hookFiles")} value={fileCountValue} />
					<InfoRow
						label={tw("popover.hookSourceMeta")}
						value={present(snap?.sourceMeta !== undefined)}
					/>
					<InfoRow
						label={tw("popover.hookSearchMeta")}
						value={present(snap?.searchMeta !== undefined)}
					/>
					<InfoRow
						label={tw("popover.hookCover")}
						value={present(snap?.coverLocal !== undefined)}
					/>
					<InfoRow label={tw("popover.hookHashes")} value={hashValue} />
					<InfoRow label={tw("popover.hookErrors")} value={errorsValue} />
				</div>

				<Separator />

				<SectionLabel>{tw("popover.sectionCapabilities")}</SectionLabel>
				<div className="flex flex-col gap-1.5">
					<InfoRow
						label={tw("popover.capPreview")}
						value={tw(ctx?.capabilities.preview ? "popover.yes" : "popover.no")}
					/>
					<InfoRow
						label={tw("popover.capFrame")}
						value={tw(ctx?.capabilities.frame ? "popover.yes" : "popover.no")}
					/>
				</div>

				<Separator />

				<SectionLabel>{tw("popover.sectionPresentation")}</SectionLabel>
				<InfoRow label={tw("popover.mode")} value={tw(`mode.${mode}`)} />
			</PopoverContent>
		</Popover>
	)
}

function InfoRow(props: { readonly label: string; readonly value: string }) {
	const { label, value } = props
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="text-xs text-muted-foreground">{label}</span>
			<span className="min-w-0 truncate text-xs text-foreground">{value}</span>
		</div>
	)
}
