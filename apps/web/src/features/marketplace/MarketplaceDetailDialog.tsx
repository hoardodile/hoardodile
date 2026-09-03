import { AppDialog } from "@hoardodile/ui/components/app-dialog"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { MetaChip } from "@hoardodile/ui/components/meta-chip"
import { SectionTabs } from "@hoardodile/ui/components/section-tabs"
import { Skeleton } from "@hoardodile/ui/components/skeleton"
import {
	Bug,
	MagicWand2,
	PlugCircle,
	ShieldCheck,
} from "@hoardodile/ui/icons/registry"
import { useQuery } from "@tanstack/react-query"
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
import { errorMessage } from "@/lib/errors"
import { isNewer } from "@/lib/versions"
import type { RouterOutputs } from "@/trpc/client"
import { isMinAppSatisfied, marketUpdateAvailable } from "./compat"
import { marketplaceDetailQueryOptions } from "./marketplaceApi"
import { PluginMarkdown } from "./PluginMarkdown"

export type MarketPlugin =
	RouterOutputs["marketplace"]["snapshot"]["plugins"][number]

export type InstalledPlugin = RouterOutputs["plugin"]["listAll"][number]

/** One plugin's authoritative latest release (asset / notes / readme). */
export type MarketLatest = NonNullable<
	RouterOutputs["marketplace"]["detail"]["latest"]
>

/**
 * One plugin's authoritative release state, fetched on demand when the view
 * opens. `undefined` while the on-demand fetch is in flight.
 */
export type MarketPluginDetail = RouterOutputs["marketplace"]["detail"]

/** The markdown tabs of the detail dialog. */
type MarketplaceTab = "readme" | "release"

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

/**
 * `owner/repo` + release tag → the base URL release assets are served from.
 * The readme `PluginMarkdown` resolves relative image references against it,
 * so readme images (published as flat release assets) render from the release.
 */
export function releaseDownloadBase(repo: string, tag: string): string {
	return `https://github.com/${repo}/releases/download/${tag}/`
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
 * Pick the readme markdown for a UI language: exact locale → base language
 * (`zh-CN` → `zh`) → `en` (the bare `README.md` fallback) → the only
 * shipped language.
 */
export function pickReadmeMarkdown(
	readme: Readonly<Record<string, string>> | undefined,
	language: string,
): string | undefined {
	if (readme === undefined) return undefined
	const exact = readme[language]
	if (exact !== undefined) return exact
	const base = language.split("-")[0] ?? language
	const partial = readme[base]
	if (partial !== undefined) return partial
	const english = readme.en
	if (english !== undefined) return english
	return Object.values(readme)[0]
}

/**
 * Read-only detail view — everything the card hides, in one place. Shared
 * by the marketplace catalog and the plugins page's "details" menu entry.
 * The authoritative release (asset / notes / readme) is fetched on demand
 * when the dialog opens and cached per repo, so the list never consumes the
 * quota-hungry GitHub API. Actions are owned by the caller:
 * {@link props.onInstall} / {@link props.onUninstall} stay outside so the
 * install confirmation and the uninstall dialog can live next to the
 * caller's other dialogs.
 */
export function MarketplaceDetailDialog(props: {
	readonly open: boolean
	readonly plugin: MarketPlugin
	readonly installed?: InstalledPlugin
	readonly onOpenChange: (open: boolean) => void
	/** The caller hands the install confirmation the authoritative `latest`. */
	readonly onInstall: (latest: MarketLatest) => void
	/** Optional: the host hands the update confirmation to the caller;
	    absent (e.g. the plugins page) the update entry is hidden. */
	readonly onUpdate?: (latest: MarketLatest) => void
	readonly onUninstall: () => void
}) {
	const { t, i18n } = useTranslation()
	const { plugin } = props
	const installedVersion = props.installed?.manifest.version
	const compatible = isMinAppSatisfied(plugin.manifest)

	// The on-demand authoritative release — fetched only when the view opens.
	const detailQuery = useQuery(
		marketplaceDetailQueryOptions(plugin.repo, plugin.id),
	)
	const detail = detailQuery.data
	const detailPending = detailQuery.isPending
	const detailFailed = detailQuery.isError

	// The version line renders immediately from the snapshot's free-feed
	// `latest`; the authoritative detail (once loaded) refines it.
	const displayLatest = detail?.latest ?? plugin.latest

	// An update is actionable only when the newer release's asset was fetched
	// by the on-demand detail; a rate-limited version-only release is
	// surfaced as a notice, not a button.
	const updateAvailable =
		props.onUpdate !== undefined &&
		detail !== undefined &&
		marketUpdateAvailable(
			{ state: detail.state, latest: detail.latest, manifest: plugin.manifest },
			installedVersion,
		) &&
		detail.latest?.assetUrl !== undefined
	const [tab, setTab] = useState<MarketplaceTab>("readme")

	useEffect(() => {
		if (props.open) setTab("readme")
	}, [props.open, props.plugin.id])

	const readmeContent = pickReadmeMarkdown(
		detail?.latest?.readme,
		i18n.language,
	)
	const readmeLanguages =
		detail?.latest?.readme === undefined
			? []
			: Object.keys(detail.latest.readme)
	// The readme render resolves relative images against the release's
	// download base (readme assets are published with each release).
	const readmeImageBase =
		displayLatest === undefined
			? undefined
			: releaseDownloadBase(plugin.repo, displayLatest.tag)
	const canInstall =
		installedVersion === undefined &&
		compatible &&
		detail?.latest?.assetUrl !== undefined
	// The rate-limit signal the ticker shows: a known (but not yet actioned)
	// version reads differently from a plain "info unavailable" notice.
	const dialogError = (() => {
		if (detailFailed) {
			return errorMessage(detailQuery.error, t("common.error"))
		}
		if (detail?.rateLimited === true && detail.latest?.version !== undefined) {
			return t("marketplace.updateUnavailableRateLimited", {
				version: detail.latest.version,
			})
		}
		if (detail?.errorKind === "rate_limited" || detail?.rateLimited === true) {
			return t("marketplace.errorRateLimitedShort")
		}
		return detail?.error ?? ""
	})()

	const showErrorBanner =
		detailFailed || detail?.state === "error" || detail?.rateLimited === true

	// The readme / release tabs need the on-demand detail; show a skeleton
	// while it is in flight (or the "no readme / no release notes" copy on
	// failure or a no-release repo).
	const notice =
		detail?.state === "no_release"
			? t("marketplace.noRelease")
			: t("marketplace.noReleaseNotes")

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
				displayLatest === undefined
					? undefined
					: versionDateLine(displayLatest, i18n.language)
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
							onClick={() => props.onInstall(detail.latest!)}
							data-testid="marketplace-detail-install"
						>
							{t("marketplace.install")}
						</Button>
					) : null}
					{updateAvailable ? (
						<Button
							onClick={() => {
								props.onOpenChange(false)
								props.onUpdate?.(detail.latest!)
							}}
							data-testid="marketplace-detail-update"
						>
							{t("marketplace.updateTo", {
								version: displayLatest?.version ?? "",
							})}
						</Button>
					) : null}
				</>
			}
		>
			{showErrorBanner && (
				<div
					className="flex h-6 shrink-0 items-center overflow-hidden rounded-md bg-muted text-tiny text-destructive"
					data-testid="marketplace-dialog-error"
				>
					<span className="market-ticker-track" aria-hidden>
						{[0, 1].map((copy) => (
							<span
								key={copy}
								className="flex shrink-0 items-center"
								title={dialogError}
							>
								<span className="whitespace-nowrap px-3">{dialogError}</span>
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
						value: "readme",
						label: t("marketplace.readme"),
						testId: "marketplace-detail-tab-readme",
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
									{displayLatest !== undefined && (
										<MetaChip>
											{t("marketplace.latestRelease")} v{displayLatest.version}
										</MetaChip>
									)}
									{installedVersion !== undefined &&
										displayLatest !== undefined &&
										isNewer(displayLatest.version, installedVersion) && (
											<MetaChip tone="bordered">
												{installedVersion} → {displayLatest.version}
											</MetaChip>
										)}
									{detail?.state === "no_release" && (
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
									{displayLatest !== undefined && (
										<MetadataRow label={t("marketplace.latestRelease")}>
											<ExternalLink
												href={displayLatest.releaseUrl}
												className="break-all underline-offset-2 hover:underline"
											>
												{versionDateLine(displayLatest, i18n.language)}
											</ExternalLink>
										</MetadataRow>
									)}
									{detail?.latest?.assetName !== undefined && (
										<MetadataRow label={t("marketplace.packageAsset")}>
											<span className="break-all font-mono">
												{detail.latest.assetName}
											</span>
										</MetadataRow>
									)}
									{detail?.latest?.sha256 !== undefined && (
										<MetadataRow label={t("marketplace.checksum")}>
											<span className="break-all font-mono">
												{detail.latest.sha256}
											</span>
										</MetadataRow>
									)}
									{readmeLanguages.length > 0 && (
										<MetadataRow label={t("marketplace.languages")}>
											<span className="flex flex-wrap gap-1">
												{readmeLanguages.map((locale) => (
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
									{detailPending ? (
										<div
											className="flex flex-col gap-2"
											data-testid="marketplace-detail-loading"
										>
											<Skeleton className="h-3 w-full" />
											<Skeleton className="h-3 w-4/5" />
											<Skeleton className="h-3 w-2/3" />
										</div>
									) : readmeContent !== undefined ? (
										<PluginMarkdown
											repo={plugin.repo}
											markdown={readmeContent}
											imageBaseUrl={readmeImageBase}
										/>
									) : (
										<p className="text-xs text-muted-foreground">
											{t("marketplace.noReadme")}
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
						panel: detailPending ? (
							<div
								className="flex flex-col gap-2"
								data-testid="marketplace-detail-loading"
							>
								<Skeleton className="h-3 w-full" />
								<Skeleton className="h-3 w-4/5" />
								<Skeleton className="h-3 w-2/3" />
							</div>
						) : detail?.latest?.notes !== null &&
							detail?.latest?.notes !== undefined ? (
							<PluginMarkdown
								repo={plugin.repo}
								markdown={detail.latest.notes}
							/>
						) : (
							<p className="text-xs text-muted-foreground">{notice}</p>
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
