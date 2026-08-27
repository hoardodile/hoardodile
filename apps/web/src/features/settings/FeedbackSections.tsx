import { Button, buttonVariants } from "@hoardodile/ui/components/button"
import { ConfirmDialog } from "@hoardodile/ui/components/confirm-dialog"
import { Icon } from "@hoardodile/ui/components/icon"
import { toast } from "@hoardodile/ui/components/toast"
import { Bug, Download, Rocket } from "@hoardodile/ui/icons/registry"
import { useState } from "react"
import { useTranslation } from "react-i18next"
import { ExternalLink, openExternalUrl } from "@/components/common/ExternalLink"
import {
	APP_ISSUES_BUG_DESKTOP_URL,
	APP_ISSUES_BUG_SELFHOSTED_URL,
	APP_ISSUES_FEATURE_URL,
	bugIssueUrl,
} from "@/lib/appInfo"
import { getDesktopBridge, isHoardodileDesktop } from "@/lib/desktop"
import { downloadLogArchive } from "@/lib/logArchive"
import { SettingsSection } from "./SettingsSection"

/**
 * Feedback blocks on the Settings → About tab. The bug section is one
 * horizontal focus: title and description on the left, two stacked actions
 * on the right — report the issue (template + prefilled version) and
 * download the log archive (frontend + server `.log` files in one zip) to
 * attach to it. The desktop shell keeps the server-log folder as a quiet
 * gray text link below the actions (a maintainer-requested debugging aid).
 */
export function BugReportSection() {
	const { t } = useTranslation()
	// A bridge is only present in the Electron shell: route the report to
	// the template matching how the reporter runs the app (the desktop
	// bundles its own server, so a browser visitor is self-hosted).
	const template = isHoardodileDesktop()
		? APP_ISSUES_BUG_DESKTOP_URL
		: APP_ISSUES_BUG_SELFHOSTED_URL
	return (
		<SettingsSection
			icon={Bug}
			title={t("me.about.bugTitle")}
			description={t("me.about.bugDescription")}
			layout="compact"
			data-testid="me-section-bug"
		>
			<div className="flex flex-col items-end gap-2">
				<Button
					data-testid="me-feedback-bug"
					onClick={() => {
						// Synchronous, inside the user gesture: the form opens
						// with the version prefilled; the log archive is the
						// second action one row below.
						openExternalUrl(bugIssueUrl(template))
					}}
				>
					<Icon icon={Bug} />
					{t("me.about.bugAction")}
				</Button>
				<DownloadLogsButton />
				{isHoardodileDesktop() ? <OpenServerLogsLink /> : null}
			</div>
		</SettingsSection>
	)
}

function DownloadLogsButton() {
	const { t } = useTranslation()
	const [confirmOpen, setConfirmOpen] = useState(false)
	const [zipping, setZipping] = useState(false)

	async function handleDownload() {
		setZipping(true)
		try {
			await downloadLogArchive()
			toast.add({ title: t("me.about.logsArchiveDownloaded"), type: "success" })
			setConfirmOpen(false)
		} catch {
			toast.add({ title: t("me.about.logsArchiveFailed"), type: "error" })
		} finally {
			setZipping(false)
		}
	}

	return (
		<>
			<Button
				variant="secondary"
				onClick={() => setConfirmOpen(true)}
				data-testid="me-feedback-download-logs"
			>
				<Icon icon={Download} />
				{t("me.about.downloadLogs")}
			</Button>
			<ConfirmDialog
				open={confirmOpen}
				onOpenChange={setConfirmOpen}
				title={t("me.about.logsArchiveConfirmTitle")}
				description={t("me.about.logsArchiveConfirmNote")}
				confirmLabel={t("me.about.downloadLogs")}
				pendingLabel={t("me.about.logsArchiving")}
				confirmTestId="me-logs-archive-confirm"
				cancelTestId="me-logs-archive-cancel"
				isPending={zipping}
				onConfirm={() => {
					void handleDownload()
				}}
			/>
		</>
	)
}

function OpenServerLogsLink() {
	const { t } = useTranslation()
	const desktop = getDesktopBridge()
	const [opening, setOpening] = useState(false)

	async function handleOpen() {
		if (desktop === undefined) return
		setOpening(true)
		try {
			const ok = await desktop.openLogsFolder()
			if (!ok) throw new Error("openLogsFolder failed")
		} catch {
			toast.add({ title: t("me.about.openLogsFailed"), type: "error" })
		} finally {
			setOpening(false)
		}
	}

	return (
		<button
			type="button"
			disabled={opening}
			onClick={() => {
				void handleOpen()
			}}
			data-testid="me-feedback-open-logs"
			className="text-tiny text-muted-foreground cursor-pointer underline-offset-4 hover:text-foreground hover:underline disabled:opacity-60"
		>
			{t("me.about.openLogsFolder")}
		</button>
	)
}

export function FeatureRequestSection() {
	const { t } = useTranslation()
	return (
		<SettingsSection
			icon={Rocket}
			title={t("me.about.featureTitle")}
			description={t("me.about.featureDescription")}
			layout="compact"
			data-testid="me-section-feature"
		>
			<ExternalLink
				href={APP_ISSUES_FEATURE_URL}
				data-testid="me-feedback-feature"
				className={buttonVariants({ variant: "secondary" })}
			>
				<Icon icon={Rocket} />
				{t("me.about.featureAction")}
			</ExternalLink>
		</SettingsSection>
	)
}
