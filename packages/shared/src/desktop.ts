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
	readonly autoStart: boolean
	readonly startInTray: boolean
	readonly autoUpdate: boolean
	readonly portable: boolean
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
	completeWizard: (result: DesktopWizardResult) => Promise<void>
	getWizardDefaults: () => Promise<{
		readonly libraryPath: string
	}>
}
