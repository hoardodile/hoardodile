import { Button } from "./button.tsx"
import { Checkbox } from "./checkbox.tsx"
import { AppDialog } from "./app-dialog.tsx"
import { useEffect, useState } from "react"

/**
 * The shared plugin asset-download consent dialog — host chrome used by
 * both host surfaces (the app and the workbench) so the user sees one
 * dialog with one contract wherever a plugin asks to download.
 *
 * Presentational by design: the queue lives in the host's consent store
 * (`@hoardodile/host-web`), this component renders exactly one ticket
 * and reports the decision through callbacks. Nothing here imports
 * anything outside `@hoardodile/ui`, keeping the SDK closure intact.
 */

/**
 * A queued consent ticket, structurally identical to the server's
 * `pluginDownloadRequested` SSE event minus its `type` discriminator
 * (and to `@hoardodile/host-web`'s consent-store entry). Declared here
 * instead of imported so this package stays closure-clean.
 */
export type PluginConsentTicket = {
	readonly ticketId: string
	readonly pluginId: string
	readonly pluginName: string
	readonly url: string
	readonly dest: string
	readonly sizeBytes?: number
	readonly reason?: string
}

/** Minimal translate signature both host apps can satisfy. */
export type PluginConsentTranslate = (
	key: string,
	opts?: Record<string, unknown>,
) => string

const DEFAULT_LABELS: Readonly<Record<string, string>> = {
	eyebrow: "Plugin download",
	title: "Download this file?",
	description:
		"{{pluginName}} wants to download a file into its own storage folder. The file is fetched from the URL below and stored only inside the plugin's folder.",
	urlLabel: "URL",
	destLabel: "Destination",
	sizeLabel: "Size",
	unknownSize: "unknown",
	deny: "Deny",
	allow: "Allow",
	remember: "Remember for this session (no more prompts from this plugin)",
}

function defaultTranslate(key: string, opts?: Record<string, unknown>): string {
	const bare = key.replace(/^pluginDownload\./, "")
	let out = DEFAULT_LABELS[bare] ?? key
	if (opts !== undefined) {
		for (const [name, value] of Object.entries(opts)) {
			out = out.replace(`{{${name}}}`, String(value))
		}
	}
	return out
}

export type PluginDownloadConsentDialogProps = {
	/** Ticket to show; `null` hides the dialog (one at a time). */
	readonly entry: PluginConsentTicket | null
	/** Decision callbacks — the host wires them to its own decide path. */
	readonly onDeny: (ticketId: string) => void
	readonly onAllow: (ticketId: string, remember: boolean) => void
	/** Host i18n; falls back to the built-in English labels. */
	readonly t?: PluginConsentTranslate
	/** Byte formatter; defaults to `"<n> B"`. */
	readonly formatBytes?: (bytes: number) => string
}

/**
 * Renders the shared consent question: URL verbatim (selectable
 * monospace, never a link), the vault-relative destination and the
 * plugin's stated reason, with Allow / Deny and a session-remember
 * checkbox.
 *
 * Design contract (hd-plugin-design): card + hairline + `--radius-2xl`
 * + `--shadow-dialog`, footer parted by an inset hairline, focus on the
 * dialog container; the danger stays in copy and actions, never in color.
 */
export function PluginDownloadConsentDialog(
	props: PluginDownloadConsentDialogProps,
) {
	const { entry, onDeny, onAllow } = props
	const t = props.t ?? defaultTranslate
	const formatBytes = props.formatBytes ?? ((bytes: number) => `${bytes} B`)
	const activeId = entry === null ? null : entry.ticketId
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
			title={t("pluginDownload.title", undefined)}
			eyebrow={t("pluginDownload.eyebrow", undefined)}
			description={
				entry === null
					? undefined
					: t("pluginDownload.description", { pluginName: entry.pluginName })
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
			{entry === null ? null : (
				<ConsentBody
					entry={entry}
					remember={remember}
					onRememberChange={setRemember}
					t={t}
					formatBytes={formatBytes}
				/>
			)}
		</AppDialog>
	)
}

function ConsentBody(props: {
	readonly entry: PluginConsentTicket
	readonly remember: boolean
	readonly onRememberChange: (value: boolean) => void
	readonly t: PluginConsentTranslate
	readonly formatBytes: (bytes: number) => string
}) {
	const { entry, remember, onRememberChange, t, formatBytes } = props
	return (
		<div className="flex flex-col gap-4">
			<div className="flex flex-col gap-1.5">
				<span className="text-xs tracking-label text-muted-foreground uppercase">
					{t("pluginDownload.urlLabel", undefined)}
				</span>
				<code
					className="rounded-sm bg-muted px-2 py-1.5 text-xs text-secondary-foreground break-all select-all"
					data-testid="plugin-download-url"
				>
					{entry.url}
				</code>
			</div>
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
		</div>
	)
}
