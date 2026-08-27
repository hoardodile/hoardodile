import { Button, buttonVariants } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { toast } from "@hoardodile/ui/components/toast"
import { Bug, Rocket } from "@hoardodile/ui/icons/registry"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { copyText } from "@/components/common/AppErrorPage"
import { ExternalLink } from "@/components/common/ExternalLink"
import {
	APP_ISSUES_BUG_DESKTOP_URL,
	APP_ISSUES_BUG_SELFHOSTED_URL,
	APP_ISSUES_FEATURE_URL,
} from "@/lib/appInfo"
import { formatDiagnostics } from "@/lib/clientLog"
import { getDesktopBridge, isHoardodileDesktop } from "@/lib/desktop"
import { SettingsSection } from "./SettingsSection"

/**
 * Feedback blocks on the Settings → About tab — one section per
 * destination, each leading straight into the repo's issue template.
 *
 * The bug section also carries the diagnostics export: one click copies
 * app identity, platform and the recent frontend log (the client log ring
 * buffer captured from console / window errors) for pasting into the
 * issue's "Actual behavior and logs" field. Desktop additionally offers
 * opening the server's log folder (`<library>/local/logs`); self-hosted
 * browsers are pointed at the same path under their storage root.
 */
export function BugReportSection() {
	const { t } = useTranslation()
	const desktop = getDesktopBridge()
	const [logsPath, setLogsPath] = useState<string | null>(null)
	// A bridge is only present in the Electron shell: route the report to
	// the template matching how the reporter runs the app (the desktop
	// bundles its own server, so a browser visitor is self-hosted).
	const href = isHoardodileDesktop()
		? APP_ISSUES_BUG_DESKTOP_URL
		: APP_ISSUES_BUG_SELFHOSTED_URL

	useEffect(() => {
		if (desktop === undefined) return
		void desktop
			.getConfig()
			.then((config) => setLogsPath(`${config.libraryPath}/local/logs`))
			.catch(() => {})
	}, [desktop])

	return (
		<SettingsSection
			icon={Bug}
			title={t("me.about.bugTitle")}
			description={t("me.about.bugDescription")}
			layout="compact"
			data-testid="me-section-bug"
		>
			<div className="flex flex-wrap items-center gap-2">
				<ExternalLink
					href={href}
					data-testid="me-feedback-bug"
					className={buttonVariants({ variant: "secondary" })}
				>
					<Icon icon={Bug} />
					{t("me.about.bugAction")}
				</ExternalLink>
				<CopyDiagnosticsButton />
				{isHoardodileDesktop() ? <OpenLogsButton /> : null}
			</div>
			<p className="mt-3 text-tiny text-muted-foreground">
				{desktop !== undefined
					? `${t("me.about.logsFolderHint")}${
							logsPath !== null ? `: ${logsPath}` : ""
						}`
					: t("me.about.selfHostedLogsHint")}
			</p>
		</SettingsSection>
	)
}

function CopyDiagnosticsButton() {
	const { t } = useTranslation()
	const [copying, setCopying] = useState(false)

	async function handleCopy() {
		setCopying(true)
		try {
			await copyText(formatDiagnostics())
			toast.add({ title: t("me.about.diagnosticsCopied"), type: "success" })
		} catch {
			toast.add({ title: t("me.about.copyDiagnosticsFailed"), type: "error" })
		} finally {
			setCopying(false)
		}
	}

	return (
		<Button
			variant="secondary"
			disabled={copying}
			onClick={() => {
				void handleCopy()
			}}
			data-testid="me-feedback-copy-diagnostics"
		>
			{t("me.about.copyDiagnostics")}
		</Button>
	)
}

function OpenLogsButton() {
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
		<Button
			variant="secondary"
			disabled={opening}
			onClick={() => {
				void handleOpen()
			}}
			data-testid="me-feedback-open-logs"
		>
			{t("me.about.openLogsFolder")}
		</Button>
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
