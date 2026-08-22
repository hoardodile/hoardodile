import type {
	DesktopUpdateState,
	HoardodileDesktopBridge,
} from "@hoardodile/shared/desktop"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import { InfoCircle, Link, RefreshCircle } from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "@/components/common/ExternalLink"
import { APP_REPOSITORY_URL, APP_VERSION } from "@/lib/appInfo"
import { getDesktopBridge } from "@/lib/desktop"
import { checkForUpdate, type UpdateCheckResult } from "./checkUpdates"
import { SettingsSection } from "./SettingsSection"

type BrowserUpdateState =
	| { readonly status: "idle" | "checking" }
	| UpdateCheckResult

/**
 * About block on the App settings tab: app name and version chip,
 * repository link, and an update check. Browser tabs hit the GitHub API
 * on click; the desktop shell uses the preload updater (same GitHub
 * artifacts, one brain).
 */
export function AboutSection() {
	const desktop = getDesktopBridge()
	return desktop === undefined ? (
		<BrowserAboutSection />
	) : (
		<DesktopAboutSection desktop={desktop} />
	)
}

function BrowserAboutSection() {
	const { t } = useTranslation()
	const [update, setUpdate] = useState<BrowserUpdateState>({ status: "idle" })

	async function handleCheck() {
		setUpdate({ status: "checking" })
		setUpdate(await checkForUpdate(APP_VERSION))
	}

	return (
		<AboutFrame
			action={
				<Button
					variant="secondary"
					className="shrink-0"
					onClick={() => {
						void handleCheck()
					}}
					disabled={update.status === "checking"}
					data-testid="me-about-check-update"
				>
					<RefreshCircle
						className={cn(
							"size-4",
							update.status === "checking" && "animate-spin",
						)}
					/>
					{t("me.about.checkUpdate")}
				</Button>
			}
		>
			{update.status === "checking" ? (
				<p className="mt-3 text-tiny text-muted-foreground">
					{t("me.about.checking")}
				</p>
			) : null}
			{update.status === "latest" ? (
				<p className="mt-3 text-tiny text-muted-foreground">
					{t("me.about.latest")}
				</p>
			) : null}
			{update.status === "outdated" ? (
				<p className="mt-3 text-tiny" data-testid="me-about-outdated">
					{t("me.about.outdated", { version: update.version })}{" "}
					<ExternalLink
						href={update.url}
						className="text-primary underline-offset-4 hover:underline"
					>
						{t("me.about.viewRelease")}
					</ExternalLink>
				</p>
			) : null}
			{update.status === "error" ? (
				<p className="mt-3 text-tiny text-destructive">
					{t("me.about.updateError")}
				</p>
			) : null}
		</AboutFrame>
	)
}

function DesktopAboutSection(props: {
	readonly desktop: HoardodileDesktopBridge
}) {
	const { desktop } = props
	const { t } = useTranslation()
	const [state, setState] = useState<DesktopUpdateState>({ status: "idle" })

	useEffect(() => {
		void desktop.updates.status().then(setState)
		return desktop.updates.onStatus(setState)
	}, [desktop])

	if (desktop.updates.portable) {
		return (
			<AboutFrame>
				<p className="mt-3 text-tiny text-muted-foreground">
					{t("me.about.portableHint")}{" "}
					<ExternalLink
						href={`${APP_REPOSITORY_URL}/releases`}
						className="text-primary underline-offset-4 hover:underline"
					>
						{t("me.about.viewRelease")}
					</ExternalLink>
				</p>
			</AboutFrame>
		)
	}

	const busy = state.status === "checking" || state.status === "downloading"

	return (
		<AboutFrame
			action={
				<Button
					variant="secondary"
					className="shrink-0 [-webkit-app-region:no-drag]"
					onClick={() => {
						void desktop.updates.check()
					}}
					disabled={busy}
					data-testid="me-about-check-update"
				>
					<RefreshCircle className={cn("size-4", busy && "animate-spin")} />
					{t("me.about.checkUpdate")}
				</Button>
			}
		>
			{state.status === "checking" ? (
				<p className="mt-3 text-tiny text-muted-foreground">
					{t("me.about.checking")}
				</p>
			) : null}
			{state.status === "downloading" ? (
				<p className="mt-3 text-tiny text-muted-foreground">
					{t("me.about.downloading", {
						percent: Math.round(state.percent),
					})}
				</p>
			) : null}
			{state.status === "latest" ? (
				<p className="mt-3 text-tiny text-muted-foreground">
					{t("me.about.latest")}
				</p>
			) : null}
			{state.status === "ready" ? (
				<div className="mt-3 flex flex-wrap items-center gap-3">
					<p className="text-tiny" data-testid="me-about-outdated">
						{t("me.about.updateReady", { version: state.version })}
					</p>
					<Button
						size="sm"
						className="[-webkit-app-region:no-drag]"
						onClick={() => {
							void desktop.updates.quitAndInstall()
						}}
						data-testid="me-about-restart"
					>
						{t("me.about.restartToUpdate")}
					</Button>
				</div>
			) : null}
			{state.status === "error" ? (
				<p className="mt-3 text-tiny text-destructive">
					{t("me.about.updateError")}
				</p>
			) : null}
		</AboutFrame>
	)
}

function AboutFrame(props: {
	readonly action?: ReactNode
	readonly children?: ReactNode
}) {
	const { t } = useTranslation()
	return (
		<SettingsSection
			icon={InfoCircle}
			title={t("me.about.title")}
			description={t("me.about.description")}
			layout="stack"
			data-testid="me-section-about"
		>
			<div>
				<div className="flex flex-wrap items-start justify-between gap-x-6 gap-y-3">
					<div className="min-w-0">
						<div className="flex items-center gap-2.5">
							<span className="text-xl font-bold text-foreground">
								hoardodile
							</span>
							<MetaChip>v{APP_VERSION}</MetaChip>
						</div>
						<p className="mt-1.5 text-xs leading-5 text-muted-foreground">
							{t("me.about.tagline")}
						</p>
						<ExternalLink
							href={APP_REPOSITORY_URL}
							className="mt-2 inline-flex items-center gap-1.5 text-xs text-secondary-foreground hover:text-foreground"
						>
							<Icon icon={Link} />
							{APP_REPOSITORY_URL}
						</ExternalLink>
					</div>
					{props.action}
				</div>
				{props.children}
			</div>
		</SettingsSection>
	)
}
