import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { DropdownSelect } from "@hoardodile/ui/components/dropdown-select"
import { Icon } from "@hoardodile/ui/components/icon"
import { Label } from "@hoardodile/ui/components/label"
import {
	RadioGroup,
	RadioGroupItem,
} from "@hoardodile/ui/components/radio-group"
import { TransferHorizontal } from "@hoardodile/ui/icons/registry"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"
import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
	contentPluginUsageQueryOptions,
	replaceContentPluginMutation,
	resKeys,
} from "@/features/res/api"
import { errorMessage } from "@/lib/errors"
import { resolveManifestName } from "./manifestText"
import { pluginKeys, pluginListAllQueryOptions } from "./pluginApi"

type RebuildMode = "immediate" | "defer"

type ReplaceContentResult = {
	readonly affected: number
	readonly failures: readonly {
		readonly id: string
		readonly reasons: readonly string[]
	}[]
}

/**
 * Move every resource one content plugin owns to another. The plugin id
 * swap and the derived-metadata clear are atomic per resource; the user
 * only picks whether the metadata rebuild runs immediately (background)
 * or is deferred to the next time each resource is opened. The "from"
 * picker lists every content-owning plugin — including orphaned (deleted)
 * ones, shown by a short id — so content left behind by an uninstalled
 * plugin can still be migrated to a live target.
 */
export function ReplaceContentPluginDialog(props: {
	readonly open: boolean
	readonly onOpenChange: (open: boolean) => void
	/** Preselect a source plugin (e.g. the row the action came from). */
	readonly initialFromPluginId?: string
}) {
	const { t, i18n } = useTranslation()
	const qc = useQueryClient()
	const { open, onOpenChange, initialFromPluginId } = props

	const listQuery = useQuery(pluginListAllQueryOptions())
	const usageQuery = useQuery(contentPluginUsageQueryOptions())

	const [fromPluginId, setFromPluginId] = useState("")
	const [toPluginId, setToPluginId] = useState("")
	const [rebuild, setRebuild] = useState<RebuildMode>("defer")
	const [result, setResult] = useState<ReplaceContentResult | null>(null)
	const [error, setError] = useState<string | null>(null)

	// Reset the draft each time the dialog opens.
	useEffect(() => {
		if (!open) return
		setFromPluginId(initialFromPluginId ?? "")
		setToPluginId("")
		setRebuild("defer")
		setResult(null)
		setError(null)
	}, [open, initialFromPluginId])

	const replaceMut = useMutation({
		...replaceContentPluginMutation(),
		onSuccess: async (data) => {
			await Promise.all([
				qc.invalidateQueries({ queryKey: resKeys.all }),
				qc.invalidateQueries({ queryKey: pluginKeys.all }),
				qc.invalidateQueries({ queryKey: resKeys.usage }),
			])
			// Stay open; report the outcome at the bottom of the body.
			setResult(data)
			setError(null)
		},
		onError: (err) => {
			setResult(null)
			setError(errorMessage(err, t("common.error")))
		},
	})

	const plugins = listQuery.data ?? []
	const usage = usageQuery.data ?? []
	const byId = useMemo(() => new Map(plugins.map((p) => [p.id, p])), [plugins])

	/** Source candidates: every content-owning plugin, live or orphaned. */
	const fromOptions = useMemo(
		() =>
			usage.map((u) => {
				const live = byId.get(u.pluginId)
				if (live !== undefined) {
					return {
						value: u.pluginId,
						label: `${resolveManifestName(live.manifest, i18n.language)} (${u.count})`,
					}
				}
				return {
					value: u.pluginId,
					label: `${t("plugins.replaceContentMissingLabel")} · ${shortPluginId(u.pluginId)} (${u.count})`,
				}
			}),
		[usage, byId, i18n.language, t],
	)

	/** Target candidates: healthy, enabled plugins, never the selected source. */
	const toOptions = useMemo(
		() =>
			plugins
				.filter((p) => !p.missing && p.enabled)
				.filter((p) => p.id !== fromPluginId)
				.map((p) => ({
					value: p.id,
					label: resolveManifestName(p.manifest, i18n.language),
				})),
		[plugins, fromPluginId, i18n.language],
	)

	const fromCount = usage.find((u) => u.pluginId === fromPluginId)?.count ?? 0
	const canSubmit =
		fromPluginId !== "" &&
		toPluginId !== "" &&
		toPluginId !== fromPluginId &&
		fromCount > 0 &&
		!replaceMut.isPending

	return (
		<AppDialog
			open={open}
			onOpenChange={onOpenChange}
			title={t("plugins.replaceContentTitle")}
			icon={<Icon icon={TransferHorizontal} size="lg" />}
			description={t("plugins.replaceContentDescription")}
			size="md"
			contentTestId="replace-content-dialog"
			footer={
				<>
					<Button
						variant="secondary"
						onClick={() => onOpenChange(false)}
						disabled={replaceMut.isPending}
					>
						{t("common.cancel")}
					</Button>
					<Button
						onClick={() =>
							replaceMut.mutate({
								fromPluginId,
								toPluginId,
								rebuild,
							})
						}
						disabled={!canSubmit}
						data-testid="replace-content-confirm"
					>
						{replaceMut.isPending
							? t("common.working")
							: t("plugins.replaceContentConfirm")}
					</Button>
				</>
			}
		>
			<div className="flex flex-col gap-4">
				{fromOptions.length === 0 ? (
					<p className="text-sm text-muted-foreground">
						{t("plugins.replaceContentEmptyFrom")}
					</p>
				) : (
					<>
						<div className="flex flex-col gap-1.5">
							<Label>{t("plugins.replaceContentFrom")}</Label>
							<DropdownSelect
								value={fromPluginId}
								onValueChange={(v) => {
									setFromPluginId(v)
									if (v === toPluginId) setToPluginId("")
								}}
								options={fromOptions}
								placeholder={t("plugins.replaceContentFrom")}
								triggerClassName="w-full justify-between"
								data-testid="replace-content-from"
							/>
							{fromPluginId !== "" && fromCount === 0 ? (
								<p className="text-xs text-destructive">
									{t("plugins.replaceContentNoContent")}
								</p>
							) : null}
						</div>

						<div className="flex flex-col gap-1.5">
							<Label>{t("plugins.replaceContentTo")}</Label>
							<DropdownSelect
								value={toPluginId}
								onValueChange={setToPluginId}
								options={toOptions}
								placeholder={t("plugins.replaceContentToPlaceholder")}
								triggerClassName="w-full justify-between"
								data-testid="replace-content-to"
							/>
							{fromPluginId !== "" && toPluginId === fromPluginId ? (
								<p className="text-xs text-destructive">
									{t("plugins.replaceContentSamePlugin")}
								</p>
							) : null}
						</div>

						<div className="flex flex-col gap-2">
							<Label>{t("plugins.replaceContentRebuild")}</Label>
							<RadioGroup
								value={rebuild}
								onValueChange={(v) => setRebuild(v as RebuildMode)}
								className="gap-2"
								data-testid="replace-content-rebuild"
							>
								<div className="flex items-start gap-2">
									<RadioGroupItem
										value="immediate"
										aria-label={t("plugins.replaceContentRebuildImmediate")}
									/>
									<span className="flex flex-col">
										<span className="text-sm">
											{t("plugins.replaceContentRebuildImmediate")}
										</span>
										<span className="text-xs text-muted-foreground">
											{t("plugins.replaceContentRebuildImmediateDescription")}
										</span>
									</span>
								</div>
								<div className="flex items-start gap-2">
									<RadioGroupItem
										value="defer"
										aria-label={t("plugins.replaceContentRebuildDefer")}
									/>
									<span className="flex flex-col">
										<span className="text-sm">
											{t("plugins.replaceContentRebuildDefer")}
										</span>
										<span className="text-xs text-muted-foreground">
											{t("plugins.replaceContentRebuildDeferDescription")}
										</span>
									</span>
								</div>
							</RadioGroup>
						</div>
					</>
				)}
				{error !== null ? (
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3">
						<span className="text-sm font-medium text-destructive">
							{error}
						</span>
					</div>
				) : result !== null ? (
					<div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-border pt-3">
						<span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-500">
							{t("plugins.replaceContentPassed")} {result.affected}
						</span>
						{result.failures.length > 0 ? (
							<span className="inline-flex items-center gap-1.5 text-sm font-medium text-destructive">
								{t("plugins.replaceContentFailed")} {result.failures.length}
							</span>
						) : null}
					</div>
				) : null}
			</div>
		</AppDialog>
	)
}

/** Render a long plugin id compactly for orphaned source options. */
function shortPluginId(id: string): string {
	return id.length > 12 ? `${id.slice(0, 8)}…` : id
}
