import type {
	DesktopShellConfig,
	HoardodileDesktopBridge,
	LanInfo,
} from "@hoardodile/shared/desktop"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Input } from "@hoardodile/ui/components/input"
import { Spinner } from "@hoardodile/ui/components/spinner"
import { Switch } from "@hoardodile/ui/components/switch"
import { toast } from "@hoardodile/ui/components/toast"
import { Cross } from "@hoardodile/ui/icons/marks"
import {
	Copy,
	InfoCircle,
	MonitorSmartphone,
} from "@hoardodile/ui/icons/registry"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import QRCode from "react-qr-code"
import { ConfirmDialog } from "@/components/common/ConfirmDialog"
import { getDesktopBridge } from "@/lib/desktop"
import { SettingsSection } from "./SettingsSection"
import { SectionDivider } from "./SettingsSheet"

/**
 * Device-local key for the dismissed port-conflict notice. Not server
 * synced: the adjustment is specific to this machine's port layout.
 */
const PORT_ADJUST_DISMISS_KEY = "desktop.lan.portAdjustedDismissed"

/**
 * Desktop-only local-network sharing: serve the sidecar on all IPv4
 * interfaces with a configurable port, list the reachable addresses and
 * render a QR code for phones. Enabling or changing the port restarts the
 * sidecar; the window reloads (production) once it is back.
 */
export function LanSharingSection() {
	const desktop = getDesktopBridge()
	const [config, setConfig] = useState<DesktopShellConfig | undefined>()
	const [lan, setLan] = useState<LanInfo | undefined>()

	useEffect(() => {
		if (desktop === undefined) return
		void desktop.getConfig().then(setConfig)
		void desktop.getLanInfo().then(setLan)
	}, [desktop])

	// DHCP renewals move the address; re-read whenever the window regains
	// focus so the shown list and QR stay accurate.
	useEffect(() => {
		if (desktop === undefined) return
		const bridge = desktop
		function refreshOnFocus() {
			void bridge.getConfig().then(setConfig)
			void bridge.getLanInfo().then(setLan)
		}
		window.addEventListener("focus", refreshOnFocus)
		return () => {
			window.removeEventListener("focus", refreshOnFocus)
		}
	}, [desktop])

	if (desktop === undefined || config === undefined || lan === undefined) {
		return null
	}
	return (
		<LanSharingForm
			desktop={desktop}
			onRefresh={(nextConfig, nextLan) => {
				setConfig(nextConfig)
				setLan(nextLan)
			}}
			config={config}
			lan={lan}
		/>
	)
}

function LanSharingForm(props: {
	readonly desktop: HoardodileDesktopBridge
	readonly config: DesktopShellConfig
	readonly lan: LanInfo
	readonly onRefresh: (config: DesktopShellConfig, lan: LanInfo) => void
}) {
	const { desktop, config, lan, onRefresh } = props
	const { t } = useTranslation()
	const [portInput, setPortInput] = useState(String(lan.preferredPort))
	const [busy, setBusy] = useState(false)
	const [weakConfirmOpen, setWeakConfirmOpen] = useState(false)
	// Device-local dismiss of the port-conflict notice: value is the
	// `(preferredPort, port)` pair it was dismissed for, so a later
	// conflict on a different fallback port shows the notice again.
	const [dismissedAdjustment, setDismissedAdjustment] = useState<
		string | undefined
	>(() => {
		try {
			return localStorage.getItem(PORT_ADJUST_DISMISS_KEY) ?? undefined
		} catch {
			return undefined
		}
	})

	const portValue = Number(portInput.trim())
	const portDirty = portInput.trim() !== String(lan.preferredPort)
	const portValid =
		Number.isInteger(portValue) && portValue >= 1 && portValue <= 65535
	const portAdjusted = lan.port !== lan.preferredPort
	const adjustmentKey = `${lan.preferredPort}:${lan.port}`
	// Only relevant while sharing is on: the copy tells other devices to
	// use the new port, and with sharing off nothing else displays it.
	const portAdjustedNotice =
		config.lanEnabled && portAdjusted && dismissedAdjustment !== adjustmentKey

	function dismissPortAdjusted(): void {
		setDismissedAdjustment(adjustmentKey)
		try {
			localStorage.setItem(PORT_ADJUST_DISMISS_KEY, adjustmentKey)
		} catch {
			// best-effort
		}
	}

	async function refresh(): Promise<void> {
		const [nextConfig, nextLan] = await Promise.all([
			desktop.getConfig(),
			desktop.getLanInfo(),
		])
		onRefresh(nextConfig, nextLan)
		setPortInput(String(nextLan.preferredPort))
	}

	/**
	 * Enable or disable sharing and restart the sidecar. A declined weak
	 * password is not an error: the shell resolves `{ ok: false,
	 * reason: "weak-password-required" }` so the in-app confirm dialog is
	 * shown instead; retrying with `weakPasswordConfirmed` is how the
	 * user accepts the risk (the shell re-checks the password each time).
	 */
	async function enable(
		enabled: boolean,
		options?: { readonly weakPasswordConfirmed?: boolean },
	): Promise<void> {
		if (busy) return
		setBusy(true)
		try {
			const result =
				options === undefined
					? await desktop.setLanEnabled(enabled)
					: await desktop.setLanEnabled(enabled, options)
			if (result.ok) {
				await refresh()
				return
			}
			if (result.reason === "weak-password-required") {
				setWeakConfirmOpen(true)
				return
			}
			// no admin password: the shell pointed it out in a native box
			// (an unclaimed instance must never become reachable); say it
			// in-app too so the switch not moving is never silent.
			toast.add({
				title: t("me.desktop.lan.passwordRequired"),
				type: "error",
			})
		} catch {
			// genuine failure (restart failed): the shell pointed out the
			// native error; the switch stays at the previous state
		} finally {
			setBusy(false)
		}
	}

	async function handleWeakConfirm(): Promise<void> {
		// Keep the dialog open while the sidecar restarts — its button
		// label switches to the pending copy (isPending + pendingLabel).
		await enable(true, { weakPasswordConfirmed: true })
		setWeakConfirmOpen(false)
	}

	async function handlePortApply() {
		if (busy || !portValid || !portDirty) return
		setBusy(true)
		try {
			await desktop.setLanPort(portValue)
			await refresh()
		} catch {
			// restart failed; the shell reverted the port and surfaced the error
		} finally {
			setBusy(false)
		}
	}

	function handleCopy(url: string) {
		void navigator.clipboard.writeText(url).then(
			() => {
				toast.add({ title: t("me.desktop.lan.copied"), type: "success" })
			},
			() => {
				toast.add({ title: t("me.desktop.lan.copyFailed"), type: "error" })
			},
		)
	}

	const urls = lan.addresses.map((entry) => ({
		label: entry.address,
		address: entry.address,
		url: `http://${entry.address}:${lan.port}/`,
		interfaceName: entry.interfaceName,
	}))
	const primary = urls[0]
	const others = urls.slice(1)

	return (
		<>
			<SettingsSection
				icon={MonitorSmartphone}
				title={t("me.desktop.lan.title")}
				description={t("me.desktop.lan.description")}
				layout="stack"
				data-testid="desktop-lan-section"
			>
				<div className="flex flex-col gap-4">
					<div
						className="flex items-center justify-between gap-6"
						aria-busy={busy}
					>
						<div className="min-w-0">
							<div className="text-ui font-semibold text-foreground">
								{t("me.desktop.lan.enable")}
							</div>
							<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
								{t("me.desktop.lan.enableDescription")}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-2 [-webkit-app-region:no-drag]">
							{busy ? (
								<Spinner
									className="size-4 text-muted-foreground"
									aria-label={t("me.desktop.lan.applying")}
									data-testid="desktop-lan-busy"
								/>
							) : null}
							<Switch
								checked={config.lanEnabled}
								onCheckedChange={(enabled) => {
									void enable(enabled)
								}}
								disabled={busy}
								aria-label={t("me.desktop.lan.enable")}
								data-testid="desktop-lan-enable"
							/>
						</div>
					</div>
					<div className="flex flex-wrap items-center justify-between gap-3">
						<div className="min-w-0">
							<div className="text-ui font-semibold text-foreground">
								{t("me.desktop.lan.portTitle")}
							</div>
							<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
								{t("me.desktop.lan.portDescription")}
							</p>
						</div>
						<div className="flex shrink-0 items-center gap-2">
							<Input
								type="number"
								inputMode="numeric"
								min={1}
								max={65535}
								value={portInput}
								onChange={(event) => {
									setPortInput(event.currentTarget.value)
								}}
								className="w-28 [-webkit-app-region:no-drag]"
								data-testid="desktop-lan-port-input"
							/>
							<Button
								variant="secondary"
								disabled={busy || !portValid || !portDirty}
								onClick={() => {
									void handlePortApply()
								}}
								data-testid="desktop-lan-port-apply"
							>
								{t("me.desktop.lan.portApply")}
							</Button>
						</div>
					</div>
					{portAdjustedNotice ? (
						<div
							className="flex items-start gap-3 rounded-lg bg-muted px-3 py-2.5"
							data-testid="desktop-lan-port-adjusted"
						>
							<Icon
								icon={InfoCircle}
								className="mt-0.5 shrink-0 text-muted-foreground"
							/>
							<div className="min-w-0">
								<div className="text-ui font-semibold text-foreground">
									{t("me.desktop.lan.portAdjustedTitle", {
										preferred: lan.preferredPort,
										actual: lan.port,
									})}
								</div>
								<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
									{t("me.desktop.lan.portAdjustedHint")}
								</p>
							</div>
							<Button
								variant="ghost"
								size="icon-sm"
								aria-label={t("me.desktop.lan.portAdjustedDismiss")}
								data-testid="desktop-lan-port-adjusted-dismiss"
								className="ml-auto shrink-0"
								onClick={dismissPortAdjusted}
							>
								<Cross />
							</Button>
						</div>
					) : null}
					{config.lanEnabled ? (
						<div className="flex flex-col gap-4">
							{primary !== undefined ? (
								<div className="flex items-start gap-4">
									<div className="shrink-0 rounded-lg bg-white p-2.5">
										<QRCode value={primary.url} size={120} />
									</div>
									<div className="min-w-0 flex-1">
										<p className="text-xs leading-5 text-muted-foreground">
											{t("me.desktop.lan.primaryHint")}
										</p>
										<div
											className="mt-1 break-all text-ui font-semibold text-foreground"
											data-testid="desktop-lan-primary-url"
										>
											{primary.url}
										</div>
										<Button
											variant="secondary"
											className="mt-2 [-webkit-app-region:no-drag]"
											onClick={() => {
												handleCopy(primary.url)
											}}
											data-testid="desktop-lan-copy-primary"
										>
											<Icon icon={Copy} />
											{t("me.desktop.lan.copy")}
										</Button>
									</div>
								</div>
							) : (
								<p
									className="text-xs leading-5 text-muted-foreground"
									data-testid="desktop-lan-no-addresses"
								>
									{t("me.desktop.lan.noAddresses")}
								</p>
							)}
							{others.length > 0 ? (
								<details className="group">
									<summary
										className="cursor-pointer select-none text-xs text-muted-foreground hover:text-secondary-foreground"
										data-testid="desktop-lan-more-addresses"
									>
										{t("me.desktop.lan.moreAddresses", {
											count: others.length,
										})}
									</summary>
									<ul className="mt-2 flex flex-col gap-2">
										{others.map((entry) => (
											<li
												key={entry.url}
												className="flex flex-wrap items-center justify-between gap-3"
											>
												<div className="min-w-0">
													<div className="truncate text-ui text-foreground">
														{entry.url}
													</div>
													<p className="truncate text-xs text-muted-foreground">
														{entry.interfaceName}
													</p>
												</div>
												<Button
													variant="secondary"
													className="shrink-0 [-webkit-app-region:no-drag]"
													onClick={() => {
														handleCopy(entry.url)
													}}
													data-testid={`desktop-lan-copy-${entry.address}`}
												>
													<Icon icon={Copy} />
													{t("me.desktop.lan.copy")}
												</Button>
											</li>
										))}
									</ul>
								</details>
							) : null}
						</div>
					) : null}
				</div>
			</SettingsSection>
			<SectionDivider />
			<ConfirmDialog
				open={weakConfirmOpen}
				onOpenChange={setWeakConfirmOpen}
				title={t("me.desktop.lan.weakPasswordTitle")}
				description={t("me.desktop.lan.weakPasswordDescription")}
				confirmLabel={t("me.desktop.lan.enableAnyway")}
				isPending={busy}
				pendingLabel={t("me.desktop.lan.applying")}
				onConfirm={() => {
					void handleWeakConfirm()
				}}
				confirmTestId="desktop-lan-weak-confirm"
				cancelTestId="desktop-lan-weak-cancel"
			/>
		</>
	)
}
