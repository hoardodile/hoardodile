import type {
	DesktopShellConfig,
	HoardodileDesktopBridge,
	LanInfo,
} from "@hoardodile/shared/desktop"
import { Button } from "@hoardodile/ui/components/button"
import { Icon } from "@hoardodile/ui/components/icon"
import { Input } from "@hoardodile/ui/components/input"
import { Switch } from "@hoardodile/ui/components/switch"
import { toast } from "@hoardodile/ui/components/toast"
import { Copy, MonitorSmartphone } from "@hoardodile/ui/icons/registry"
import { useEffect, useState } from "react"
import { useTranslation } from "react-i18next"
import QRCode from "react-qr-code"
import { getDesktopBridge } from "@/lib/desktop"
import { SettingsSection } from "./SettingsSection"
import { SectionDivider } from "./SettingsSheet"

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
	const [portInput, setPortInput] = useState(String(lan.port))
	const [busy, setBusy] = useState(false)

	const portValue = Number(portInput.trim())
	const portDirty = portInput.trim() !== String(lan.port)
	const portValid =
		Number.isInteger(portValue) && portValue >= 1 && portValue <= 65535

	async function refresh(): Promise<void> {
		const [nextConfig, nextLan] = await Promise.all([
			desktop.getConfig(),
			desktop.getLanInfo(),
		])
		onRefresh(nextConfig, nextLan)
		setPortInput(String(nextLan.port))
	}

	async function handleEnabled(enabled: boolean) {
		if (busy) return
		setBusy(true)
		try {
			await desktop.setLanEnabled(enabled)
			await refresh()
		} catch {
			// rejection is surface by the shell (password required, restart
			// failed); the switch stays at the previous state
		} finally {
			setBusy(false)
		}
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
		url: `http://${entry.address}:${lan.port}/`,
		interfaceName: entry.interfaceName,
	}))
	const primaryUrl = urls[0]?.url

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
					<div className="flex items-center justify-between gap-6">
						<div className="min-w-0">
							<div className="text-ui font-semibold text-foreground">
								{t("me.desktop.lan.enable")}
							</div>
							<p className="mt-0.5 text-xs leading-5 text-muted-foreground">
								{t("me.desktop.lan.enableDescription")}
							</p>
						</div>
						<Switch
							checked={config.lanEnabled}
							onCheckedChange={(enabled) => {
								void handleEnabled(enabled)
							}}
							disabled={busy}
							aria-label={t("me.desktop.lan.enable")}
							data-testid="desktop-lan-enable"
							className="[-webkit-app-region:no-drag]"
						/>
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
					{config.lanEnabled ? (
						<ul className="flex flex-col gap-3">
							{urls.map((entry) => (
								<li
									key={entry.url}
									className="flex flex-wrap items-center justify-between gap-3"
								>
									<div className="min-w-0">
										<div className="text-ui font-semibold text-foreground">
											{entry.label}
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
										data-testid={`desktop-lan-copy-${entry.url}`}
									>
										<Icon icon={Copy} />
										{t("me.desktop.lan.copy")}
									</Button>
								</li>
							))}
							{primaryUrl !== undefined ? (
								<li className="flex items-start gap-4">
									<div className="shrink-0 rounded-lg bg-white p-2.5">
										<QRCode value={primaryUrl} size={120} />
									</div>
									<p
										className="pt-2 text-xs leading-5 text-muted-foreground"
										data-testid="desktop-lan-qr-hint"
									>
										{t("me.desktop.lan.qrHint")}
									</p>
								</li>
							) : null}
						</ul>
					) : null}
				</div>
			</SettingsSection>
			<SectionDivider />
		</>
	)
}
