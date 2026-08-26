import { Button } from "./button.tsx"
import { Checkbox } from "./checkbox.tsx"
import { AppDialog } from "./app-dialog.tsx"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"

/**
 * The shared plugin asset-download consent dialog — host chrome used by
 * both host surfaces (the app and the workbench) so the user sees one
 * dialog with one contract wherever a plugin asks to download.
 *
 * One entry = one batch question: a single download is an items array of
 * one (rendered with the single-file layout); a batched plugin call is
 * one dialog listing every item, answered all-or-nothing.
 *
 * Presentational by design: the queue lives in the host's consent store
 * (`@hoardodile/host-web`), this component renders exactly one ticket
 * and reports the decision through callbacks. Copy comes from the shared
 * `ui` catalog namespace (`pluginDownload.*`), so every React surface
 * renders the same localized strings; nothing here imports anything
 * outside `@hoardodile/ui` + `@hoardodile/i18n`, keeping the SDK closure
 * intact.
 */

/**
 * A queued consent ticket, structurally identical to the server's
 * `pluginDownloadRequested` SSE event minus its `type` discriminator
 * (and to `@hoardodile/host-web`'s consent-store entry). Declared here
 * instead of imported so this package stays closure-clean.
 */
export type PluginConsentItem = {
	readonly url: string
	readonly dest: string
	readonly sizeBytes?: number
	readonly reason?: string
}

export type PluginConsentTicket = {
	readonly ticketId: string
	readonly pluginId: string
	readonly pluginName: string
	readonly items: readonly PluginConsentItem[]
}

export type PluginDownloadConsentDialogProps = {
	/** Ticket to show; `null` hides the dialog (one at a time). */
	readonly entry: PluginConsentTicket | null
	/** Decision callbacks — the host wires them to its own decide path. */
	readonly onDeny: (ticketId: string) => void
	readonly onAllow: (ticketId: string, remember: boolean) => void
	/** Byte formatter; defaults to `"<n> B"`. */
	readonly formatBytes?: (bytes: number) => string
}

/**
 * Renders the shared consent question: every download URL verbatim
 * (selectable monospace, never a link), its vault-relative destination
 * and the plugin's stated reason, with Allow / Deny and a session-remember
 * checkbox. A batch is one dialog listing all items.
 *
 * Design contract (hd-plugin-design): card + hairline + `--radius-2xl`
 * + `--shadow-dialog`, footer parted by an inset hairline, focus on the
 * dialog container; the danger stays in copy and actions, never in color.
 */
export function PluginDownloadConsentDialog(
	props: PluginDownloadConsentDialogProps,
) {
	const { entry, onDeny, onAllow } = props
	const { t } = useTranslation("ui", { useSuspense: false })
	const formatBytes = props.formatBytes ?? ((bytes: number) => `${bytes} B`)
	const activeId = entry === null ? null : entry.ticketId
	const itemCount = entry === null ? 0 : entry.items.length
	const [remember, setRemember] = useState(false)

	// A fresh ticket starts with "remember" unchecked — the choice must
	// never leak from one download to the next.
	useEffect(() => {
		setRemember(false)
	}, [activeId])

	return (
		<AppDialog
			open={entry !== null}
			onOpenChange={(open) => {
				if (!open && activeId !== null) onDeny(activeId)
			}}
			title={
				entry === null || itemCount <= 1
					? t("pluginDownload.title", undefined)
					: t("pluginDownload.titleMany", { count: itemCount })
			}
			eyebrow={t("pluginDownload.eyebrow", undefined)}
			description={
				entry === null
					? undefined
					: itemCount <= 1
						? t("pluginDownload.description", {
								pluginName: entry.pluginName,
							})
						: t("pluginDownload.descriptionMany", {
								pluginName: entry.pluginName,
								count: itemCount,
							})
			}
			size="md"
			contentTestId="plugin-download-consent"
			footer={
				<div className="flex w-full items-center justify-between">
					<Button
						variant="outline"
						size="sm"
						disabled={activeId === null}
						onClick={() => activeId !== null && onDeny(activeId)}
						data-testid="plugin-download-deny"
					>
						{t("pluginDownload.deny", undefined)}
					</Button>
					<Button
						size="sm"
						disabled={activeId === null}
						onClick={() =>
							activeId !== null && onAllow(activeId, remember)
						}
						data-testid="plugin-download-allow"
					>
						{t("pluginDownload.allow", undefined)}
					</Button>
				</div>
			}
		>
			{entry === null ? null : itemCount <= 1 ? (
				<ConsentBody
					entry={entry.items[0]!}
					remember={remember}
					onRememberChange={setRemember}
					formatBytes={formatBytes}
				/>
			) : (
				<ConsentBatch
					items={entry.items}
					remember={remember}
					onRememberChange={setRemember}
				/>
			)}
		</AppDialog>
	)
}

function ConsentBody(props: {
	readonly entry: PluginConsentItem
	readonly remember: boolean
	readonly onRememberChange: (value: boolean) => void
	readonly formatBytes: (bytes: number) => string
}) {
	const { entry, remember, onRememberChange, formatBytes } = props
	const { t } = useTranslation("ui", { useSuspense: false })
	return (
		<div className="flex flex-col gap-4">
			<ConsentUrlField label={t("pluginDownload.urlLabel", undefined)} url={entry.url} />
			<div className="flex flex-col gap-1.5">
				<span className="text-xs tracking-label text-muted-foreground uppercase">
					{t("pluginDownload.destLabel", undefined)}
				</span>
				<code
					className="text-xs text-secondary-foreground break-all select-all"
					data-testid="plugin-download-dest"
				>
					{entry.dest}
				</code>
			</div>
			<div className="text-xs text-muted-foreground">
				{t("pluginDownload.sizeLabel", undefined)}:{" "}
				{entry.sizeBytes === undefined
					? t("pluginDownload.unknownSize", undefined)
					: formatBytes(entry.sizeBytes)}
			</div>
			{entry.reason !== undefined && entry.reason.length > 0 ? (
				<p className="text-xs text-secondary-foreground italic">
					{entry.reason}
				</p>
			) : null}
			<RememberRow remember={remember} onRememberChange={onRememberChange} />
		</div>
	)
}

/** Batch layout: one row per download, URL verbatim + dest + reason. */
function ConsentBatch(props: {
	readonly items: readonly PluginConsentItem[]
	readonly remember: boolean
	readonly onRememberChange: (value: boolean) => void
}) {
	const { items, remember, onRememberChange } = props
	const { t } = useTranslation("ui", { useSuspense: false })
	return (
		<div className="flex flex-col gap-4">
			<ul className="flex max-h-52 flex-col gap-3 overflow-y-auto pr-1">
				{items.map((item, index) => (
					<li
						key={`${item.url}#${item.dest}`}
						className="flex flex-col gap-1 rounded-md border border-border px-2.5 py-2"
						data-testid={`plugin-download-item-${index}`}
					>
						<ConsentUrlField
							label={t("pluginDownload.itemLabel", {
								index: index + 1,
							})}
							url={item.url}
							testId={`plugin-download-url-${index}`}
						/>
						<code
							className="text-xs text-secondary-foreground break-all select-all"
							data-testid={`plugin-download-dest-${index}`}
						>
							{item.dest}
						</code>
						{item.reason !== undefined && item.reason.length > 0 ? (
							<p className="text-xs text-secondary-foreground italic">
								{item.reason}
							</p>
						) : null}
					</li>
				))}
			</ul>
			<p className="text-xs text-muted-foreground">
				{t("pluginDownload.batchNote", { count: items.length })}
			</p>
			<RememberRow remember={remember} onRememberChange={onRememberChange} />
		</div>
	)
}

function ConsentUrlField(props: {
	readonly label: string
	readonly url: string
	readonly testId?: string
}) {
	return (
		<div className="flex min-w-0 flex-col gap-1">
			<span className="text-xs tracking-label text-muted-foreground uppercase">
				{props.label}
			</span>
			<code
				className="rounded-sm bg-muted px-2 py-1.5 text-xs text-secondary-foreground break-all select-all"
				data-testid={props.testId ?? "plugin-download-url"}
			>
				{props.url}
			</code>
		</div>
	)
}

function RememberRow(props: {
	readonly remember: boolean
	readonly onRememberChange: (value: boolean) => void
}) {
	const { remember, onRememberChange } = props
	const { t } = useTranslation("ui", { useSuspense: false })
	return (
		<div className="flex items-center gap-2 border-t pt-3">
			<Checkbox
				checked={remember}
				onCheckedChange={(checked) => onRememberChange(checked === true)}
				id="plugin-download-remember"
			/>
			<label
				htmlFor="plugin-download-remember"
				className="text-xs text-secondary-foreground select-none"
			>
				{t("pluginDownload.remember", undefined)}
			</label>
		</div>
	)
}
