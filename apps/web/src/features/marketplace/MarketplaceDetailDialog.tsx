import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import {
	Bug,
	MagicWand2,
	PlugCircle,
	ShieldCheck,
} from "@hoardodile/ui/icons/registry"
import { type ReactNode, useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import { ExternalLink } from "@/components/common/ExternalLink"
import { PluginTileIcon } from "@/features/plugin/icons/plugin-tile-icon"
import {
	resolveManifestDescription,
	resolveManifestName,
} from "@/features/plugin/manifestText"
import { PluginPermissionBadges } from "@/features/plugin/PluginPermissionBadges"
import { APP_VERSION } from "@/lib/appInfo"
import { isNewer } from "@/lib/versions"
import type { RouterOutputs } from "@/trpc/client"
import { isMinAppSatisfied, marketUpdateAvailable } from "./compat"
import { PluginMarkdown } from "./PluginMarkdown"

export type MarketPlugin =
	RouterOutputs["marketplace"]["snapshot"]["plugins"][number]

export type InstalledPlugin = RouterOutputs["plugin"]["listAll"][number]

/** The markdown tabs of the detail dialog. */
type MarketplaceTab = "intro" | "release"

/** `owner/repo` → its GitHub page URL (the display form the UI shows). */
export function marketRepoUrl(repo: string): string {
	return `https://github.com/${repo}`
}

/** `owner/repo` → the issue chooser (issue templates live there). */
export function issueReportUrl(repo: string): string {
	return `https://github.com/${repo}/issues/new/choose`
}

/** `owner/repo` → the private-advisory report page. */
export function securityReportUrl(repo: string): string {
	return `https://github.com/${repo}/security/advisories/new`
}

/** `v1.2.3 · Jan 2, 2025` — the version+date meta line under a title. */
export function versionDateLine(
	latest:
		| {
				readonly version: string
				readonly publishedAt: string | null | undefined
		  }
		| undefined,
	language: string,
): string {
	if (latest === undefined) return ""
	const date =
		latest.publishedAt === null || latest.publishedAt === undefined
			? ""
			: ` · ${new Date(latest.publishedAt).toLocaleDateString(language, {
					year: "numeric",
					month: "short",
					day: "numeric",
				})}`
	return `v${latest.version}${date}`
}

/**
 * Pick the intro markdown for a UI language: exact locale → base language
 * (`zh-CN` → `zh`) → `en` → the only shipped language.
 */
function pickIntroMarkdown(
	intro: Readonly<Record<string, string>> | undefined,
	language: string,
): string | undefined {
	if (intro === undefined) return undefined
	const exact = intro[language]
	if (exact !== undefined) return exact
	const base = language.split("-")[0] ?? language
	const partial = intro[base]
	if (partial !== undefined) return partial
	const english = intro.en
	if (english !== undefined) return english
	return Object.values(intro)[0]
}

/**
 * Read-only detail view — everything the card hides, in one place. Shared
 * by the marketplace catalog and the plugins page's "details" menu entry.
 * Actions are owned by the caller: {@link props.onInstall} / {@link props.onUninstall}
 * stay outside so the install confirmation and the uninstall dialog can
 * live next to the caller's other dialogs.
 */
export function MarketplaceDetailDialog(props: {
	readonly open: boolean
	readonly plugin: MarketPlugin
	readonly installed?: InstalledPlugin
	readonly onOpenChange: (open: boolean) => void
	readonly onInstall: () => void
	/** Optional: the host hands the update confirmation to the caller;
	    absent (e.g. the plugins page) the update entry is hidden. */
	readonly onUpdate?: () => void
	readonly onUninstall: () => void
}) {
	const { t, i18n } = useTranslation()
	const { plugin } = props
	const latest = plugin.state === "ok" ? plugin.latest : undefined
	const installedVersion = props.installed?.manifest.version
	const compatible = isMinAppSatisfied(plugin.manifest)
	const updateAvailable =
		props.onUpdate !== undefined &&
		marketUpdateAvailable(plugin, installedVersion)
	const [tab, setTab] = useState<MarketplaceTab>("intro")

	useEffect(() => {
		if (props.open) setTab("intro")
	}, [props.open, props.plugin.id])

	const introContent = pickIntroMarkdown(latest?.intro, i18n.language)
	const introLanguages =
		latest?.intro === undefined ? [] : Object.keys(latest.intro)
	const canInstall =
		installedVersion === undefined &&
		compatible &&
		latest?.assetUrl !== undefined

	return (
		<AppDialog
			open={props.open}
			onOpenChange={props.onOpenChange}
			size="lg"
			eyebrow={t("marketplace.pluginInfo")}
			title={resolveManifestName(plugin.manifest, i18n.language)}
			icon={
				<PluginTileIcon
					iconRef={plugin.icon}
					pluginId={plugin.id}
					fallback={PlugCircle}
				/>
			}
			description={
				latest === undefined
					? undefined
					: versionDateLine(latest, i18n.language)
			}
			contentTestId="marketplace-detail-dialog"
			footer={
				<>
					{/* Footer action layout (DESIGN.md — Overlays): with
					    three actions (installed + updateable) the bar
					    splits — the secondary function key (uninstall) sits
					    at the left edge, cancel and the primary action stay
					    right-aligned. Two-action footers never split: cancel
					    leads and the function key holds the right edge
					    (`cancel | uninstall` when installed, `cancel |
					    install` otherwise). */}
					{updateAvailable ? (
						<Button
							variant="destructive"
							className="mr-auto"
							onClick={() => {
								props.onOpenChange(false)
								props.onUninstall()
							}}
							data-testid="marketplace-detail-uninstall"
						>
							{t("plugins.uninstall")}
						</Button>
					) : null}
					<Button variant="secondary" onClick={() => props.onOpenChange(false)}>
						{t("common.cancel")}
					</Button>
					{installedVersion !== undefined && !updateAvailable ? (
						<Button
							variant="destructive"
							onClick={() => {
								props.onOpenChange(false)
								props.onUninstall()
							}}
							data-testid="marketplace-detail-uninstall"
						>
							{t("plugins.uninstall")}
						</Button>
					) : null}
					{canInstall ? (
						<Button
							onClick={props.onInstall}
							data-testid="marketplace-detail-install"
						>
							{t("marketplace.install")}
						</Button>
					) : null}
					{updateAvailable ? (
						<Button
							onClick={() => {
								props.onOpenChange(false)
								props.onUpdate?.()
							}}
							data-testid="marketplace-detail-update"
						>
							{t("marketplace.updateTo", { version: latest?.version ?? "" })}
						</Button>
					) : null}
				</>
			}
		>
			{(plugin.state === "error" || plugin.rateLimited === true) && (
				<div
					className="flex h-6 shrink-0 items-center overflow-hidden rounded-md bg-muted text-tiny text-destructive"
					data-testid="marketplace-dialog-error"
				>
					<span className="market-ticker-track" aria-hidden>
						{[0, 1].map((copy) => (
							<span
								key={copy}
								className="flex shrink-0 items-center"
								title={plugin.error}
							>
								<span className="whitespace-nowrap px-3">
									{plugin.errorKind === "rate_limited" ||
									plugin.rateLimited === true
										? t("marketplace.errorRateLimitedShort")
										: (plugin.error ?? "")}
								</span>
							</span>
						))}
					</span>
				</div>
			)}
			<SectionTabs<MarketplaceTab>
				value={tab}
				onChange={setTab}
				panelClassName="mt-3"
				items={[
					{
						value: "intro",
						label: t("marketplace.intro"),
						testId: "marketplace-detail-tab-intro",
						panel: (
							<div className="flex flex-col gap-4">
								<div className="flex flex-col gap-3">
									<p className="text-sm text-foreground">
										{resolveManifestDescription(plugin.manifest, i18n.language)}
									</p>
									<PluginPermissionBadges permissions={plugin.permissions} />
								</div>

								<div className="flex flex-wrap items-center gap-1.5">
									{installedVersion !== undefined ? (
										<MetaChip tone="inverse">
											{t("marketplace.installed", {
												version: installedVersion,
											})}
										</MetaChip>
									) : (
										<MetaChip>{t("marketplace.notInstalled")}</MetaChip>
									)}
									{latest !== undefined && (
										<MetaChip>
											{t("marketplace.latestRelease")} v{latest.version}
										</MetaChip>
									)}
									{installedVersion !== undefined &&
										latest !== undefined &&
										isNewer(latest.version, installedVersion) && (
											<MetaChip tone="bordered">
												{installedVersion} → {latest.version}
											</MetaChip>
										)}
									{plugin.state === "no_release" && (
										<MetaChip>{t("marketplace.noRelease")}</MetaChip>
									)}
									{!compatible && (
										<span className="text-xs text-destructive">
											{t("marketplace.incompatibleAppVersion", {
												require: plugin.manifest.minAppVersion,
												current: APP_VERSION,
											})}
										</span>
									)}
								</div>

								<dl className="flex flex-col gap-1.5 text-xs">
									<MetadataRow label={t("marketplace.pluginId")}>
										<span className="break-all font-mono">
											{plugin.manifest.id}
										</span>
									</MetadataRow>
									<MetadataRow label={t("marketplace.repository")}>
										<ExternalLink
											href={marketRepoUrl(plugin.repo)}
											className="break-all underline-offset-2 hover:underline"
										>
											@{plugin.repo}
										</ExternalLink>
									</MetadataRow>
									{latest !== undefined && (
										<MetadataRow label={t("marketplace.latestRelease")}>
											<ExternalLink
												href={latest.releaseUrl}
												className="break-all underline-offset-2 hover:underline"
											>
												{versionDateLine(latest, i18n.language)}
											</ExternalLink>
										</MetadataRow>
									)}
									<MetadataRow label={t("marketplace.manifestVersion")}>
										<span className="font-mono">
											v{plugin.manifest.version}
										</span>
									</MetadataRow>
									{latest?.assetName !== undefined && (
										<MetadataRow label={t("marketplace.packageAsset")}>
											<span className="break-all font-mono">
												{latest.assetName}
											</span>
										</MetadataRow>
									)}
									{latest?.sha256 !== undefined && (
										<MetadataRow label={t("marketplace.checksum")}>
											<span className="break-all font-mono">
												{latest.sha256}
											</span>
										</MetadataRow>
									)}
									{introLanguages.length > 0 && (
										<MetadataRow label={t("marketplace.languages")}>
											<span className="flex flex-wrap gap-1">
												{introLanguages.map((locale) => (
													<MetaChip key={locale}>{locale}</MetaChip>
												))}
											</span>
										</MetadataRow>
									)}
								</dl>

								<div className="flex flex-col gap-2">
									<ExternalLink
										href={issueReportUrl(plugin.repo)}
										className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
									>
										<Icon icon={Bug} size="sm" />
										{t("marketplace.reportIssue")}
									</ExternalLink>
									<ExternalLink
										href={issueReportUrl(plugin.repo)}
										className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
									>
										<Icon icon={MagicWand2} size="sm" />
										{t("marketplace.requestFeature")}
									</ExternalLink>
									<ExternalLink
										href={securityReportUrl(plugin.repo)}
										className="inline-flex items-center gap-1.5 text-xs text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
									>
										<Icon icon={ShieldCheck} size="sm" />
										{t("marketplace.reportSecurity")}
									</ExternalLink>
								</div>

								<div className="flex flex-col gap-1">
									{introContent !== undefined ? (
										<PluginMarkdown
											repo={plugin.repo}
											markdown={introContent}
										/>
									) : (
										<p className="text-xs text-muted-foreground">
											{t("marketplace.noIntro")}
										</p>
									)}
								</div>
							</div>
						),
					},
					{
						value: "release",
						label: t("marketplace.releaseNotes"),
						testId: "marketplace-detail-tab-release",
						panel:
							latest?.notes !== null && latest?.notes !== undefined ? (
								<PluginMarkdown repo={plugin.repo} markdown={latest.notes} />
							) : (
								<p className="text-xs text-muted-foreground">
									{t(
										plugin.state === "no_release"
											? "marketplace.noRelease"
											: "marketplace.noReleaseNotes",
									)}
								</p>
							),
					},
				]}
			/>
		</AppDialog>
	)
}

/** One metadata row: a muted label column + a breakable value column. */
export function MetadataRow(props: {
	readonly label: string
	readonly children: ReactNode
}) {
	return (
		<div className="grid grid-cols-[7.5rem_1fr] items-baseline gap-3">
			<dt className="text-muted-foreground">{props.label}</dt>
			<dd className="min-w-0">{props.children}</dd>
		</div>
	)
}
