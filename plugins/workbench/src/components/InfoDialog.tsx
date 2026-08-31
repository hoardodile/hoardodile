import {
	Dialog,
	DialogBody,
	DialogContent,
	DialogDescription,
	DialogHeader,
	DialogTitle,
} from "@hoardodile/ui/components/dialog"
import { SectionLabel } from "@hoardodile/ui/components/section-label"
import { Separator } from "@hoardodile/ui/components/separator"
import { useTranslation } from "react-i18next"
import type { WorkbenchPresentationMode } from "../config.ts"
import {
	describeContext,
	describeHookDiagnostics,
	type HookDiagnosticRow,
	type ResourceContext,
	type WorkbenchManifest,
	type WorkbenchResource,
} from "../context.ts"

/**
 * Plugin + resource + hook detail dialog (opened from the menu bar). The
 * hook-status *summary* line lives in the status bar (`#hook-status`); this
 * dialog shows the per-hook verdicts alongside the plugin, resource and
 * rendering-capability facts.
 */
export function InfoDialog(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	readonly manifest: WorkbenchManifest | null
	readonly resource: WorkbenchResource | undefined
	readonly ctx: ResourceContext | null
	readonly mode: WorkbenchPresentationMode
}) {
	const { open, onOpenChange, manifest, resource, ctx, mode } = props
	const { t: tw } = useTranslation("workbench")
	const hookRows = ctx === null ? null : describeHookDiagnostics(ctx)

	return (
		<Dialog open={open} onOpenChange={onOpenChange}>
			<DialogContent className="max-w-md">
				<DialogHeader>
					<DialogTitle>{tw("popover.infoTitle")}</DialogTitle>
					<DialogDescription>{tw("popover.infoDescription")}</DialogDescription>
				</DialogHeader>
				<DialogBody className="flex flex-col gap-3 pb-6">
					<SectionLabel>{tw("popover.sectionPlugin")}</SectionLabel>
					<div className="flex flex-col gap-1.5">
						<InfoRow
							label={tw("popover.pluginName")}
							value={manifest?.name ?? "—"}
						/>
						<InfoRow
							label={tw("popover.pluginId")}
							value={manifest?.id ?? "—"}
						/>
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
					<div id="hook-status" className="text-xs text-foreground">
						{ctx === null ? tw("app.loading") : describeContext(ctx)}
					</div>
					<div className="flex flex-col gap-1.5">
						{hookRows === null ? (
							<p className="text-xs text-muted-foreground">
								{tw("app.loading")}
							</p>
						) : hookRows.length === 0 ? (
							<p className="text-xs text-muted-foreground">
								{tw("popover.emptyHookSnapshot")}
							</p>
						) : (
							hookRows.map((row) => <HookRow key={keyFor(row)} row={row} />)
						)}
					</div>

					<Separator />

					<SectionLabel>{tw("popover.sectionCapabilities")}</SectionLabel>
					<div className="flex flex-col gap-1.5">
						<InfoRow
							label={tw("popover.capPreview")}
							value={tw(
								ctx?.capabilities.preview ? "popover.yes" : "popover.no",
							)}
						/>
						<InfoRow
							label={tw("popover.capFrame")}
							value={tw(ctx?.capabilities.frame ? "popover.yes" : "popover.no")}
						/>
						<InfoRow
							label={tw("popover.capCover")}
							value={tw(ctx?.capabilities.cover ? "popover.yes" : "popover.no")}
						/>
					</div>

					<Separator />

					<SectionLabel>{tw("popover.sectionPresentation")}</SectionLabel>
					<InfoRow label={tw("popover.mode")} value={tw(`mode.${mode}`)} />
				</DialogBody>
			</DialogContent>
		</Dialog>
	)
}

function HookRow(props: { readonly row: HookDiagnosticRow }) {
	const { row } = props
	const { t: tw } = useTranslation("workbench")

	switch (row.kind) {
		case "detect":
			return (
				<InfoRow
					label={tw("popover.hookDetect")}
					value={
						row.ok
							? tw("popover.hookOk")
							: row.reasons?.length
								? tw("popover.hookMissReasons", {
										reasons: row.reasons.join(", "),
									})
								: tw("popover.hookMiss")
					}
				/>
			)
		case "files":
			return (
				<InfoRow label={tw("popover.hookFiles")} value={String(row.count)} />
			)
		case "cover":
			return <InfoRow label={tw("popover.hookCover")} value={row.file} />
		case "hashes":
			return (
				<InfoRow label={tw("popover.hookHashes")} value={String(row.count)} />
			)
		case "meta":
			return <InfoRow label={row.hook} value={tw("popover.hookProvided")} />
		case "error":
			return (
				<InfoRow
					label={`${row.hook} ${tw("popover.hookFailed")}`}
					value={row.message}
					title={row.message}
				/>
			)
	}
}

function keyFor(row: HookDiagnosticRow): string {
	switch (row.kind) {
		case "detect":
			return "detect"
		case "files":
			return "files"
		case "cover":
			return "cover"
		case "hashes":
			return "hashes"
		case "meta":
			return `meta:${row.hook}`
		case "error":
			return `error:${row.hook}`
	}
}

function InfoRow(props: {
	readonly label: string
	readonly value: string
	readonly title?: string
}) {
	const { label, value, title } = props
	return (
		<div className="flex items-baseline justify-between gap-3">
			<span className="text-xs text-muted-foreground">{label}</span>
			<span title={title} className="min-w-0 truncate text-xs text-foreground">
				{value}
			</span>
		</div>
	)
}
