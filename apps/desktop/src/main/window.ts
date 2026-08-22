import { join } from "node:path"
import { app, BrowserWindow, nativeTheme, shell } from "electron"
import { SERVER_ERROR_MESSAGE, windowErrorPageUrl } from "./error-page.ts"
import { windowOpenDecision } from "./urls.ts"
import { windowBackgroundColor } from "./window-background.ts"

export type WindowKind = "wizard" | "app"

export type CreateWindowOptions = {
	readonly preloadPath: string
	readonly kind: WindowKind
	readonly url: string
	readonly wizardFile?: string
	readonly iconPath?: string
}

export function createDesktopWindow(
	options: CreateWindowOptions,
): BrowserWindow {
	const win = new BrowserWindow({
		width: options.kind === "wizard" ? 520 : 1440,
		height: options.kind === "wizard" ? 640 : 1080,
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

	win.webContents.setWindowOpenHandler(({ url }) => {
		applyWindowOpenDecision(win, url)
		return { action: "deny" }
	})
	win.webContents.on("will-navigate", (event, url) => {
		if (windowOpenDecision(url) === "same-window") return
		event.preventDefault()
		applyWindowOpenDecision(win, url)
	})

	win.once("ready-to-show", () => {
		win.show()
		if (!app.isPackaged && options.kind === "app") {
			win.webContents.openDevTools({ mode: "right" })
		}
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
		// A failed main-frame load would leave a blank window. Swap in the
		// in-window error page (centered Retry button) instead; the button
		// asks the shell to re-resolve the app URL via IPC.
		win.webContents.on("did-fail-load", (_event, _code, desc, _url, isMain) => {
			if (!isMain) return
			console.error(`[desktop] app load failed: ${desc}`)
			void win.loadURL(windowErrorPageUrl(SERVER_ERROR_MESSAGE))
		})
	}
	void win.loadURL(options.url)
}

function applyWindowOpenDecision(win: BrowserWindow, url: string): void {
	const decision = windowOpenDecision(url)
	if (decision === "same-window") {
		void win.loadURL(url)
		return
	}
	if (decision === "external") {
		void shell.openExternal(url)
	}
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
