import type {
	DesktopShellConfig,
	HoardodileDesktopBridge,
} from "@hoardodile/shared/desktop"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import {
	Global,
	InfoCircle,
	Link,
	RefreshCircle,
	User,
} from "@hoardodile/ui/icons/registry"
import { cn } from "@hoardodile/ui/lib/utils"
import type { ReactNode } from "react"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "@/components/common/ExternalLink"
import { useUpdateAvailable } from "@/components/layout/useDesktopUpdate"
import {
	APP_DEVELOPER_NAME,
	APP_DEVELOPER_URL,
	APP_REPOSITORY_URL,
	APP_VERSION,
	APP_WEBSITE_URL,
} from "@/lib/appInfo"
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
	const {
		state: updateState,
		version: availableVersion,
		markUpdateSeen,
	} = useUpdateAvailable()
	const [shellConfig, setShellConfig] = useState<DesktopShellConfig | null>(
		null,
	)
	const state = updateState ?? { status: "idle" }

	// Opening About acknowledges the current update: the availability
	// badge stays hidden for this version and only re-arms on a newer one.
	useEffect(() => {
		if (availableVersion !== undefined) markUpdateSeen(availableVersion)
	}, [availableVersion, markUpdateSeen])

	useEffect(() => {
		void desktop.getConfig().then(setShellConfig)
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
	const resourcesReady =
		state.status === "ready" && state.channel === "resources"

	return (
		<AboutFrame
			action={
				<Button
					variant="secondary"
					className="shrink-0 [-webkit-app-region:no-drag]"
					onClick={() => {
						void desktop.updates.check()
					}}
					disabled={busy || state.status === "applying"}
					data-testid="me-about-check-update"
				>
					<RefreshCircle className={cn("size-4", busy && "animate-spin")} />
					{t("me.about.checkUpdate")}
				</Button>
			}
			resourcesVersion={
				shellConfig?.resourceVersion !== null &&
				shellConfig?.resourceVersion !== APP_VERSION
					? (shellConfig?.resourceVersion ?? null)
					: null
			}
		>
			{state.status === "checking" ? (
				<p className="mt-3 text-tiny text-muted-foreground">
					{t("me.about.checking")}
				</p>
			) : null}
			{state.status === "available" ? (
				<p
					className="mt-3 text-tiny text-muted-foreground"
					data-testid="me-about-update-available"
				>
					{t("me.about.updateAvailable", { version: state.version })}
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
				<div className="mt-3">
					<div className="flex flex-wrap items-center gap-3">
						<p className="text-tiny" data-testid="me-about-outdated">
							{resourcesReady
								? t("me.about.updateReadyResources", {
										version: state.version,
									})
								: t("me.about.updateReady", { version: state.version })}
						</p>
						<Button
							size="sm"
							className="[-webkit-app-region:no-drag]"
							onClick={() => {
								void (resourcesReady
									? desktop.updates.apply()
									: desktop.updates.quitAndInstall())
							}}
							data-testid="me-about-restart"
						>
							{resourcesReady
								? t("me.about.applyResources")
								: t("me.about.restartToUpdate")}
						</Button>
					</div>
					<p className="mt-2 text-tiny text-muted-foreground">
						{resourcesReady
							? t("me.about.updateResourcesReason")
							: t("me.about.updateFullReason")}
					</p>
				</div>
			) : null}
			{state.status === "applying" ? (
				<p className="mt-3 text-tiny text-muted-foreground">
					{t(
						state.phase === "stopping"
							? "me.desktop.updatePhaseStopping"
							: state.phase === "swapping"
								? "me.desktop.updatePhaseSwapping"
								: "me.desktop.updatePhaseStarting",
					)}
				</p>
			) : null}
			{state.status === "error" ? (
				<p
					className="mt-3 text-tiny text-destructive"
					data-testid="me-about-update-error"
				>
					{t("me.about.updateError")}
				</p>
			) : null}
		</AboutFrame>
	)
}

function AboutFrame(props: {
	readonly action?: ReactNode
	readonly children?: ReactNode
	/** Set when the applied resource payload differs from the shell version. */
	readonly resourcesVersion?: string | null
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
						<div className="flex items-start gap-3">
							<img
								src="/logo.png"
								alt=""
								width={48}
								height={48}
								className="size-12 shrink-0 rounded-xl object-cover"
								decoding="async"
							/>
							<div className="min-w-0">
								<div className="flex items-center gap-2.5">
									<span className="text-xl font-bold text-foreground">
										hoardodile
									</span>
									<MetaChip>v{APP_VERSION}</MetaChip>
									{props.resourcesVersion !== undefined &&
									props.resourcesVersion !== null ? (
										<span data-testid="me-about-resources-version">
											<MetaChip>
												{t("me.about.resourcesVersion", {
													version: props.resourcesVersion,
												})}
											</MetaChip>
										</span>
									) : null}
								</div>
								<p className="mt-1.5 text-xs leading-5 text-muted-foreground">
									{t("me.about.tagline")}
								</p>
							</div>
						</div>
						<div className="mt-3 flex flex-col gap-1.5">
							<ExternalLink
								href={APP_WEBSITE_URL}
								data-testid="me-about-website"
								className="inline-flex items-center gap-1.5 text-xs text-secondary-foreground hover:text-foreground"
							>
								<Icon icon={Global} />
								{t("me.about.website")}
								<span className="text-muted-foreground">
									· {shortUrl(APP_WEBSITE_URL)}
								</span>
							</ExternalLink>
							<ExternalLink
								href={APP_REPOSITORY_URL}
								data-testid="me-about-repository"
								className="inline-flex items-center gap-1.5 text-xs text-secondary-foreground hover:text-foreground"
							>
								<Icon icon={Link} />
								{t("me.about.repository")}
								<span className="text-muted-foreground">
									· {shortUrl(APP_REPOSITORY_URL)}
								</span>
							</ExternalLink>
							<ExternalLink
								href={APP_DEVELOPER_URL}
								data-testid="me-about-developer"
								className="inline-flex items-center gap-1.5 text-xs text-secondary-foreground hover:text-foreground"
							>
								<Icon icon={User} />
								{t("me.about.developerTitle")}
								<span className="text-muted-foreground">
									· {APP_DEVELOPER_NAME}
								</span>
							</ExternalLink>
						</div>
					</div>
					{props.action}
				</div>
				{props.children}
			</div>
		</SettingsSection>
	)
}

/** URL without the protocol — a quiet hint next to an external link row. */
function shortUrl(url: string): string {
	return url.replace(/^https?:\/\//, "")
}
