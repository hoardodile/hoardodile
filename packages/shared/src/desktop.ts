/**
 * Preload bridge the Electron shell installs on `window.hoardodileDesktop`.
 * Browser tabs never see this object. Keep the surface OS-agnostic beyond
 * `platform: "desktop"` so macOS / Linux ports can reuse it.
 */

import type { SupportedLanguage } from "@hoardodile/i18n"

/**
 * Which update channel a state belongs to. `resources` replaces the
 * versioned server payload in place (no restart of the shell); `full`
 * is the electron-updater installer path.
 */
export type DesktopUpdateChannel = "resources" | "full"

export type DesktopUpdateState =
	| { readonly status: "idle" }
	| { readonly status: "checking"; readonly channel: DesktopUpdateChannel }
	| {
			readonly status: "downloading"
			readonly channel: DesktopUpdateChannel
			readonly percent: number
	  }
	| {
			readonly status: "ready"
			readonly channel: DesktopUpdateChannel
			readonly version: string
	  }
	| {
			readonly status: "applying"
			readonly channel: "resources"
			readonly phase: "stopping" | "swapping" | "starting"
	  }
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
	/**
	 * Drop the session cookie at every app start so the app always boots
	 * to the sign-in screen. Off keeps the 7-day sliding session as-is.
	 */
	readonly requireSignInOnLaunch: boolean
	/**
	 * Drop the session cookie whenever a fresh app window is created —
	 * tray reopen and second launches included — not only at boot.
	 */
	readonly requireSignInOnWindowOpen: boolean
	readonly autoUpdate: boolean
	readonly portable: boolean
	/**
	 * Version of the applied resource payload (server tree) when it differs
	 * from the shell's own app version — `null` when the shipped tree is
	 * still the installer's (or untracked yet).
	 */
	readonly resourceVersion: string | null
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

/**
 * Outcome of a `setLanEnabled` request. Enabling can be declined by the
 * shell without an error when the admin password is missing or when a
 * weak admin password has not been confirmed yet — the renderer surfaces
 * that in-app (error toast / UI confirm dialog) instead of the shell
 * logging a rejection.
 */
export type LanSetResult =
	| { readonly ok: true }
	| {
			readonly ok: false
			readonly reason: "no-admin-password" | "weak-password-required"
	  }

/**
 * Outcome of a `checkLanEnabled` probe: whether enabling would be
 * accepted right now and, when not, which confirmation the shell wants
 * the renderer to obtain first. Same vocabulary as {@link LanSetResult}.
 */
export type LanCheckResult = LanSetResult

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
	 * Toggle the DevTools dock (right side, dev only). Present on
	 * unpackaged (dev) runs only; packaged builds never expose it, so the
	 * caption bar simply hides the button.
	 */
	toggleDevtools?: () => void
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
		/** Apply the ready resource update: stop the sidecar, swap, restart. */
		apply: () => Promise<void>
		/** Install the ready full update via electron-updater (restarts the app). */
		quitAndInstall: () => Promise<void>
	}
	pickLibraryFolder: () => Promise<string | undefined>
	relaunch: () => Promise<void>
	getConfig: () => Promise<DesktopShellConfig>
	setConfig: (
		patch: Partial<
			Pick<
				DesktopShellConfig,
				| "autoStart"
				| "startInTray"
				| "autoUpdate"
				| "requireSignInOnLaunch"
				| "requireSignInOnWindowOpen"
			>
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
	setLanguage: (language: SupportedLanguage) => void
	/** The language the SPA last pushed, or undefined before the first push. */
	getLanguage: () => Promise<SupportedLanguage | undefined>
	/**
	 * Open a URL in the OS browser. Only http(s) is accepted by the shell;
	 * anything else is dropped. The SPA routes all non-app navigation
	 * (external links, non-SPA same-origin paths like `/LICENSE`) through
	 * this instead of relying on `target="_blank"` anchors.
	 */
	openExternal: (url: string) => void
	/**
	 * Register the SPA's route path patterns (full paths from the TanStack
	 * route tree, e.g. `"/characters/$id"`). The shell lets a same-origin
	 * navigation replace the app window only when its pathname matches one
	 * of these; every other URL goes to the OS browser. Sent once at app
	 * boot; new routes take effect automatically.
	 */
	registerAppRoutes: (paths: readonly string[]) => void
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
	 * Probe whether enabling local-network sharing would be accepted
	 * right now (admin password configured and not weak-consent-pending).
	 * Never restarts the sidecar or changes state; the renderer probes
	 * first so a required confirm dialog appears before any loading UI.
	 * Rejects when the sidecar is down.
	 */
	checkLanEnabled: () => Promise<LanCheckResult>
	/**
	 * Enable or disable local-network sharing and restart the sidecar
	 * with the matching bind host. Rejects when the sidecar is down or
	 * when the restart fails; resolves `{ ok: false }` when enabling is
	 * declined so the renderer can explain — `no-admin-password` never
	 * enables (an unclaimed instance must not become reachable), while
	 * `weak-password-required` means the user must confirm the weak
	 * admin password first, then retry with `{ weakPasswordConfirmed:
	 * true }` (the shell re-checks the password on every call).
	 */
	setLanEnabled: (
		enabled: boolean,
		options?: { readonly weakPasswordConfirmed?: boolean },
	) => Promise<LanSetResult>
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
