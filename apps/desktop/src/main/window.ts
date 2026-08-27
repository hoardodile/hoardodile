import { join } from "node:path"
import type { SupportedLanguage } from "@hoardodile/i18n"
import { app, BrowserWindow, nativeTheme, shell } from "electron"
import {
	devServerErrorMessage,
	rendererCrashedMessage,
	serverErrorMessage,
} from "./error-page.ts"
import {
	appWindowDecision,
	type WindowOpenDecision,
	wizardWindowDecision,
} from "./urls.ts"
import { windowBackgroundColor } from "./window-background.ts"

export type WindowKind = "wizard" | "app"

export type ShellPageTarget = {
	/** Dev wizard-server URL (ELECTRON_WIZARD_URL); empty loads the built file. */
	readonly url: string
	readonly file: string
}

/**
 * Load a shell page (loading spinner / error + retry) from the wizard
 * bundle: the dev wizard server when ELECTRON_WIZARD_URL points at one
 * (mode + message ride the query), the built `out/wizard` via loadFile
 * otherwise. `message` carries the error copy for the error mode.
 */
export async function loadShellPage(
	win: BrowserWindow,
	target: ShellPageTarget,
	mode: "loading" | "error",
	message?: string,
): Promise<void> {
	const query: Record<string, string> = { mode }
	if (message !== undefined) query.message = message
	if (target.url.length > 0) {
		const url = new URL(target.url)
		for (const [key, value] of Object.entries(query)) {
			url.searchParams.set(key, value)
		}
		await win.loadURL(url.toString())
		return
	}
	await win.loadFile(target.file, { query })
}

export type CreateWindowOptions = {
	readonly preloadPath: string
	readonly kind: WindowKind
	readonly url: string
	readonly wizardFile?: string
	readonly iconPath?: string
	/** App windows: the in-window loading/error fallback target. */
	readonly shellPage?: ShellPageTarget
	/** App windows: UI language for shell-page messages (fallback: system). */
	readonly language?: SupportedLanguage
}

export function createDesktopWindow(
	options: CreateWindowOptions,
): BrowserWindow {
	// Dev mode docks DevTools on the right when the caption-bar button
	// toggles it (see `desktop:window:toggle-devtools`): the window takes
	// the production width plus the dock's typical width, so the app still
	// renders at its designed size next to the panel instead of being
	// squeezed into the leftover ~1040px.
	const devToolsDockWidth = 600
	const width =
		options.kind === "wizard"
			? 520
			: 1440 + (app.isPackaged ? 0 : devToolsDockWidth)
	const height = options.kind === "wizard" ? 640 : 1080
	const win = new BrowserWindow({
		width,
		height,
		minWidth: options.kind === "wizard" ? 440 : 800,
		minHeight: options.kind === "wizard" ? 520 : 560,
		show: false,
		frame: false,
		transparent: false,
		autoHideMenuBar: true,
		backgroundColor: windowBackgroundColor(nativeTheme.shouldUseDarkColors),
		...(options.iconPath !== undefined ? { icon: options.iconPath } : {}),
		webPreferences: {
			preload: options.preloadPath,
			contextIsolation: true,
			sandbox: true,
			nodeIntegration: false,
			spellcheck: false,
		},
	})

	attachRendererDiagnostics(win)
	bindNativeThemeBackground()

	/**
	 * App windows may keep the window only for registered SPA routes on the
	 * app origin; wizard windows keep the historical loopback rule.
	 */
	function windowDecision(url: string): WindowOpenDecision {
		if (options.kind === "app") {
			return appWindowDecision(
				url,
				win.webContents.getURL(),
				appRoutesByWindow.get(win) ?? [],
			)
		}
		return wizardWindowDecision(url)
	}

	win.webContents.setWindowOpenHandler(({ url }) => {
		applyWindowOpenDecision(win, windowDecision(url), url)
		return { action: "deny" }
	})
	win.webContents.on("will-navigate", (event, url) => {
		const decision = windowDecision(url)
		if (decision === "same-window") return
		event.preventDefault()
		applyWindowOpenDecision(win, decision, url)
	})

	win.once("ready-to-show", () => {
		// DevTools is on demand in dev (caption-bar button, IPC
		// `desktop:window:toggle-devtools`); never auto-open — an
		// always-on DevTools panel prints Chromium-internal protocol
		// errors (Autofill domain is unimplemented in Electron) into the
		// main console on every load.
		win.show()
	})

	loadWindow(win, options)

	return win
}

export function preloadPath(desktopRoot: string): string {
	return join(desktopRoot, "out", "preload", "index.cjs")
}

function loadWindow(win: BrowserWindow, options: CreateWindowOptions): void {
	const file = options.wizardFile
	if (options.kind === "wizard" && options.url.length > 0) {
		let fallingBack = false
		win.webContents.on(
			"did-fail-load",
			(_event, _code, _desc, _url, isMain) => {
				if (!isMain || fallingBack || file === undefined) return
				fallingBack = true
				console.error(
					`[desktop] wizard dest URL failed, falling back to ${file}`,
				)
				void win.loadFile(file)
			},
		)
		void win.loadURL(options.url)
		return
	}
	if (options.kind === "wizard" && file !== undefined) {
		void win.loadFile(file)
		return
	}
	if (options.kind === "app") {
		// Any failed main-frame load — a network failure (did-fail-load)
		// or an erroring HTTP response like a 502 failure body, which
		// Chromium would render as a bare white "request failed" page and
		// which never fails the load — swaps in the in-window error page
		// (centered Retry button); the button asks the shell to re-resolve
		// the app URL via IPC. A raw failure body must never reach the
		// user, no matter which layer produced it.
		let errorPageShown = false
		function showErrorPage(): void {
			if (options.shellPage === undefined || errorPageShown) return
			errorPageShown = true
			void loadShellPage(
				win,
				options.shellPage,
				"error",
				process.env.HOARDODILE_WEB_URL === undefined
					? serverErrorMessage(undefined)
					: devServerErrorMessage(undefined),
			)
		}
		win.webContents.on("did-fail-load", (_event, _code, desc, _url, isMain) => {
			if (!isMain) return
			console.error(`[desktop] app load failed: ${desc}`)
			showErrorPage()
		})
		win.webContents.on(
			"did-frame-navigate",
			(_event, url, httpResponseCode, _statusText, isMainFrame) => {
				// -1 means a non-HTTP navigation, so only >= 400 matters.
				if (!isMainFrame || httpResponseCode < 400) return
				console.error(
					`[desktop] app load failed: HTTP ${String(httpResponseCode)} ${url}`,
				)
				showErrorPage()
			},
		)
		// Any successful load re-arms the error page so a later Retry can
		// show it again; while an error page load is in flight (or a
		// shell target itself is down), further failures are ignored —
		// the swap can never loop.
		win.webContents.on("did-finish-load", () => {
			errorPageShown = false
		})
		// The renderer process died (crash, OOM, sandbox kill). The
		// webContents survives; the next load spawns a fresh renderer, so
		// swap in the shell error page with the crash message — its Retry
		// re-resolves and re-loads the app URL (like a browser refresh).
		win.webContents.on("render-process-gone", (_event, details) => {
			console.error(
				`[desktop] renderer gone: ${details.reason} (exit ${details.exitCode})`,
			)
			if (options.shellPage === undefined) return
			void loadShellPage(
				win,
				options.shellPage,
				"error",
				rendererCrashedMessage(options.language),
			)
		})
	}
	void win.loadURL(options.url)
}

/**
 * SPA route path patterns per app window, registered by the renderer via
 * the `desktop:app:routes` IPC once the SPA boots. The app window must
 * match one of these (on the app origin) before a navigation may replace
 * it; every other URL goes to the OS browser. WeakMap: single app window,
 * patterns die with it.
 */
const appRoutesByWindow = new WeakMap<BrowserWindow, readonly string[]>()

export function setWindowAppRoutes(
	win: BrowserWindow,
	appRoutes: readonly string[],
): void {
	appRoutesByWindow.set(win, appRoutes)
}

function applyWindowOpenDecision(
	win: BrowserWindow,
	decision: WindowOpenDecision,
	url: string,
): void {
	if (decision === "same-window") {
		void win.loadURL(url)
		return
	}
	if (decision === "external") {
		console.warn(`[desktop] opening in OS browser: ${url}`)
		void shell.openExternal(url)
		return
	}
	console.warn(`[desktop] blocked navigation: ${url}`)
}

function attachRendererDiagnostics(win: BrowserWindow): void {
	win.webContents.on("did-fail-load", (_event, code, desc, url, isMain) => {
		if (!isMain) return
		console.error(`[desktop] did-fail-load ${String(code)} ${desc} ${url}`)
	})
	win.webContents.on("preload-error", (_event, path, error) => {
		console.error(`[desktop] preload-error ${path}`, error)
	})
}

let nativeThemeBound = false

function bindNativeThemeBackground(): void {
	if (nativeThemeBound) return
	nativeThemeBound = true
	nativeTheme.on("updated", syncWindowBackgrounds)
}

function syncWindowBackgrounds(): void {
	const color = windowBackgroundColor(nativeTheme.shouldUseDarkColors)
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.setBackgroundColor(color)
	}
}
