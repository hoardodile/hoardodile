/**
 * Preload bridge the Electron shell installs on `window.hoardodileDesktop`.
 * Browser tabs never see this object. Keep the surface OS-agnostic beyond
 * `platform: "desktop"` so macOS / Linux ports can reuse it.
 */

export type DesktopUpdateState =
	| { readonly status: "idle" }
	| { readonly status: "checking" }
	| { readonly status: "downloading"; readonly percent: number }
	| { readonly status: "ready"; readonly version: string }
	| { readonly status: "latest" }
	| { readonly status: "error"; readonly message: string }

export type DesktopShellConfig = {
	readonly libraryPath: string
	readonly sharedFolderRoot: string
	readonly sharedFolderEnabled: boolean
	readonly port: number
	readonly lanEnabled: boolean
	readonly autoStart: boolean
	readonly startInTray: boolean
	readonly autoUpdate: boolean
	readonly portable: boolean
}

export type LanAddress = {
	readonly interfaceName: string
	readonly address: string
}

export type LanInfo = {
	readonly enabled: boolean
	readonly port: number
	readonly addresses: readonly LanAddress[]
}

export type DesktopWizardResult = {
	readonly libraryPath: string
	readonly autoStart: boolean
	readonly startInTray: boolean
}

export type HoardodileDesktopBridge = {
	readonly isDesktop: true
	readonly platform: "desktop"
	minimize: () => void
	toggleMaximize: () => void
	close: () => void
	isMaximized: () => Promise<boolean>
	onMaximizedChange: (listener: (maximized: boolean) => void) => () => void
	readonly updates: {
		readonly portable: boolean
		status: () => Promise<DesktopUpdateState>
		onStatus: (listener: (state: DesktopUpdateState) => void) => () => void
		check: () => Promise<void>
		quitAndInstall: () => Promise<void>
	}
	pickLibraryFolder: () => Promise<string | undefined>
	relaunch: () => Promise<void>
	getConfig: () => Promise<DesktopShellConfig>
	setConfig: (
		patch: Partial<
			Pick<DesktopShellConfig, "autoStart" | "startInTray" | "autoUpdate">
		>,
	) => Promise<void>
	changeLibraryFolder: (libraryPath: string) => Promise<void>
	setSharedFolderRoot: (sharedFolderRoot: string) => Promise<void>
	setSharedFolderEnabled: (enabled: boolean) => Promise<void>
	/**
	 * Local-network sharing state plus the machine's non-loopback IPv4
	 * addresses. Resolves only when the sidecar is running.
	 */
	getLanInfo: () => Promise<LanInfo>
	/**
	 * Enable or disable local-network sharing and restart the sidecar
	 * with the matching bind host. Rejects when the sidecar is down,
	 * when no admin password is configured (LAN must never expose an
	 * unclaimed instance), or when the restart fails.
	 */
	setLanEnabled: (enabled: boolean) => Promise<void>
	/**
	 * Change the sidecar port (localhost and LAN share share one port)
	 * and restart the sidecar. Rejects on invalid ports or restart
	 * failure; a busy port falls back to a free one.
	 */
	setLanPort: (port: number) => Promise<void>
	completeWizard: (result: DesktopWizardResult) => Promise<void>
	getWizardDefaults: () => Promise<{
		readonly libraryPath: string
	}>
}
