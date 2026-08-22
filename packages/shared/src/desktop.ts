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

export type DesktopCloseAction = "ask" | "tray" | "quit"

export type DesktopShellConfig = {
	readonly libraryPath: string
	readonly sharedFolderRoot: string
	readonly sharedFolderEnabled: boolean
	readonly port: number
	readonly lanEnabled: boolean
	readonly autoStart: boolean
	readonly startInTray: boolean
	readonly closeAction: DesktopCloseAction
	readonly autoUpdate: boolean
	readonly portable: boolean
}

export type LanAddress = {
	readonly interfaceName: string
	readonly address: string
}

export type LanInfo = {
	readonly enabled: boolean
	/** Actual listening port (may differ from `preferredPort` after a conflict fallback). */
	readonly port: number
	/** Port the user last requested; the settings UI edits this value. */
	readonly preferredPort: number
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
	/**
	 * Re-attempt loading the app URL (Vite in dev, sidecar otherwise).
	 * Used by the in-window error page's Retry button; the shell decides
	 * the target and shows a fresh error page when it is still unreachable.
	 */
	retryLoad: () => void
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
	/**
	 * Persist what closing the app window does: ask each time, hide to
	 * tray, or quit. Takes effect immediately; no restart needed.
	 */
	setCloseAction: (action: DesktopCloseAction) => Promise<void>
	/**
	 * Push the app's UI language (as the SPA resolved it) so shell pages and
	 * the native ask dialog render localized copy; `navigator.language` is
	 * the shell-side fallback until the SPA has pushed once.
	 */
	setLanguage: (language: string) => void
	/** The language the SPA last pushed, or undefined before the first push. */
	getLanguage: () => Promise<string | undefined>
	/**
	 * Execute a close decision from the renderer's confirm dialog: hide to
	 * tray (window closes, app stays in the tray) or quit. When `remember`
	 * is true the choice is persisted as the close action.
	 */
	closeWithAction: (action: "tray" | "quit", remember: boolean) => Promise<void>
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
	/**
	 * Current size in bytes of the desktop shell's on-disk caches: the
	 * Chromium session caches (HTTP, compiled code, GPU shaders) plus the
	 * downloaded-update cache.
	 */
	getShellCacheSize: () => Promise<number>
	/**
	 * Clear the shell's on-disk caches and resolve with the bytes freed.
	 * Never touches cookies, localStorage or IndexedDB — those are user
	 * data. A downloaded update that is downloading or ready to install
	 * keeps its installer in the updater cache.
	 */
	clearShellCache: () => Promise<number>
	completeWizard: (result: DesktopWizardResult) => Promise<void>
	getWizardDefaults: () => Promise<{
		readonly libraryPath: string
	}>
}
