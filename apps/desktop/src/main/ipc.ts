import type { SupportedLanguage } from "@hoardodile/i18n"
import { resolveSystemLanguage } from "@hoardodile/i18n"
import type {
	DesktopShellConfig,
	DesktopUpdateState,
	DesktopWizardResult,
	LanInfo,
	LanSetResult,
} from "@hoardodile/shared/desktop"
import {
	app,
	BrowserWindow,
	dialog,
	type IpcMainEvent,
	type IpcMainInvokeEvent,
	ipcMain,
} from "electron"
import { IPC } from "../shared/ipc.ts"
import type { DesktopConfig } from "./config.ts"
import { setWindowAppRoutes } from "./window.ts"

export type IpcHost = {
	getConfig: () => DesktopConfig
	portable: () => boolean
	pickLibraryFolder: (parent?: BrowserWindow) => Promise<string | undefined>
	relaunch: () => Promise<void>
	retryLoad: () => void
	setCloseAction: (action: DesktopConfig["closeAction"]) => void
	closeWithAction: (action: "tray" | "quit", remember: boolean) => Promise<void>
	setLanguage: (language: SupportedLanguage) => void
	getLanguage: () => Promise<SupportedLanguage | undefined>
	patchConfig: (
		patch: Partial<
			Pick<DesktopConfig, "autoStart" | "startInTray" | "autoUpdate">
		>,
	) => void
	changeLibraryFolder: (libraryPath: string) => Promise<void>
	setSharedFolderRoot: (sharedFolderRoot: string) => Promise<void>
	setSharedFolderEnabled: (enabled: boolean) => Promise<void>
	lanInfo: () => LanInfo
	setLanEnabled: (
		enabled: boolean,
		options?: { readonly weakPasswordConfirmed?: boolean },
	) => Promise<LanSetResult>
	setLanPort: (port: number) => Promise<void>
	shellCacheSize: () => Promise<number>
	shellCacheClear: () => Promise<number>
	completeWizard: (result: DesktopWizardResult) => void
	defaultLibraryPath: () => string
	updateStatus: () => DesktopUpdateState
	checkUpdates: () => Promise<void>
	applyUpdate: () => Promise<void>
	quitAndInstall: () => Promise<void>
	openExternal: (url: string) => void
}

export function registerIpc(host: IpcHost): void {
	ipcMain.on(IPC.windowMinimize, (event) => {
		windowFrom(event)?.minimize()
	})
	ipcMain.on(IPC.windowToggleMaximize, (event) => {
		const win = windowFrom(event)
		if (win === undefined) return
		if (win.isMaximized()) win.unmaximize()
		else win.maximize()
	})
	ipcMain.on(IPC.windowToggleDevTools, (event) => {
		// Dev-only: the preload only exposes the caption-bar control on
		// unpackaged runs, this guard is the second line. The docked-right
		// mode needs the app to keep its designed width, hence the dev
		// width reservation in `createDesktopWindow`.
		if (app.isPackaged) return
		const contents = windowFrom(event)?.webContents
		if (contents === undefined) return
		if (contents.isDevToolsOpened()) contents.closeDevTools()
		else contents.openDevTools({ mode: "right" })
	})
	ipcMain.on(IPC.windowClose, (event) => {
		// `close()` (not `destroy()`) so the app-window close guard in the
		// shell can intercept with the configurable ask/tray/quit action;
		// wizard windows have no guard and close as before.
		windowFrom(event)?.close()
	})
	ipcMain.handle(IPC.windowIsMaximized, (event) => {
		return windowFrom(event)?.isMaximized() === true
	})
	ipcMain.handle(IPC.updatesStatus, () => host.updateStatus())
	ipcMain.handle(IPC.updatesCheck, () => host.checkUpdates())
	ipcMain.handle(IPC.updatesApply, () => host.applyUpdate())
	ipcMain.handle(IPC.updatesQuitAndInstall, () => host.quitAndInstall())
	ipcMain.handle(IPC.pickLibraryFolder, (event) =>
		host.pickLibraryFolder(windowFrom(event)),
	)
	ipcMain.handle(IPC.relaunch, () => host.relaunch())
	ipcMain.on(IPC.windowRetryLoad, () => {
		host.retryLoad()
	})
	ipcMain.on(IPC.setCloseAction, (_event, action: unknown) => {
		if (!isCloseAction(action)) return
		host.setCloseAction(action)
	})
	ipcMain.handle(IPC.closeWithAction, (_event, payload: unknown) => {
		if (!isRecord(payload)) return
		const action = payload.action
		const remember = payload.remember === true
		if (action !== "tray" && action !== "quit") return
		return host.closeWithAction(action, remember)
	})
	ipcMain.on(IPC.setLanguage, (_event, language: unknown) => {
		if (typeof language !== "string") return
		// Defense in depth: the SPA pushes a normalized code already, but a
		// region-tagged value ("de-DE") would fail `isSupportedLanguage` and
		// leave the shell in English — normalize instead of dropping.
		host.setLanguage(resolveSystemLanguage(language))
	})
	ipcMain.handle(IPC.getLanguage, () => host.getLanguage())
	ipcMain.handle(IPC.getConfig, (): DesktopShellConfig => {
		const config = host.getConfig()
		return {
			libraryPath: config.libraryPath,
			sharedFolderRoot: config.sharedFolderRoot,
			sharedFolderEnabled: config.sharedFolderEnabled,
			port: config.port,
			lanEnabled: config.lanEnabled,
			autoStart: config.autoStart,
			startInTray: config.startInTray,
			closeAction: config.closeAction,
			autoUpdate: config.autoUpdate,
			portable: host.portable(),
			resourceVersion: config.resourceVersion,
		}
	})
	ipcMain.on(IPC.configSync, (event) => {
		event.returnValue = {
			portable: host.portable(),
			devtools: !app.isPackaged,
		}
	})
	ipcMain.handle(IPC.setConfig, (_event, patch: unknown) => {
		if (!isConfigPatch(patch)) return
		host.patchConfig(patch)
	})
	ipcMain.handle(IPC.changeLibraryFolder, (_event, libraryPath: unknown) => {
		if (typeof libraryPath !== "string" || libraryPath.length === 0) return
		return host.changeLibraryFolder(libraryPath)
	})
	ipcMain.handle(
		IPC.setSharedFolderRoot,
		(_event, sharedFolderRoot: unknown) => {
			if (typeof sharedFolderRoot !== "string" || sharedFolderRoot.length === 0)
				return
			return host.setSharedFolderRoot(sharedFolderRoot)
		},
	)
	ipcMain.handle(IPC.setSharedFolderEnabled, (_event, enabled: unknown) => {
		if (typeof enabled !== "boolean") return
		return host.setSharedFolderEnabled(enabled)
	})
	ipcMain.handle(IPC.lanInfo, () => host.lanInfo())
	ipcMain.handle(
		IPC.setLanEnabled,
		(_event, enabled: unknown, options: unknown) => {
			if (typeof enabled !== "boolean") return
			return host.setLanEnabled(
				enabled,
				isRecord(options) && options.weakPasswordConfirmed === true
					? { weakPasswordConfirmed: true }
					: undefined,
			)
		},
	)
	ipcMain.handle(IPC.setLanPort, (_event, port: unknown) => {
		if (!isValidPort(port)) return
		return host.setLanPort(port)
	})
	ipcMain.handle(IPC.shellCacheSize, () => host.shellCacheSize())
	ipcMain.handle(IPC.shellCacheClear, () => host.shellCacheClear())
	ipcMain.handle(IPC.completeWizard, (_event, result: unknown) => {
		if (!isWizardResult(result)) return
		host.completeWizard(result)
	})
	ipcMain.handle(IPC.wizardDefaults, () => ({
		libraryPath: host.defaultLibraryPath(),
	}))
	// The SPA routes non-app navigation here (ExternalLink). Only http(s)
	// ever reaches the OS browser; the shell's own navigation policy is the
	// backstop for anything that bypasses the renderer (JS navigation).
	ipcMain.on(IPC.openExternal, (_event, url: unknown) => {
		if (typeof url !== "string" || !isHttpUrl(url)) {
			console.warn(`[desktop] ignored openExternal: ${String(url)}`)
			return
		}
		host.openExternal(url)
	})
	// SPA route path patterns (from the TanStack route tree) the app-window
	// navigation policy matches against; see window.ts.
	ipcMain.on(IPC.appRoutes, (event, paths: unknown) => {
		const win = windowFrom(event)
		if (win === undefined) return
		setWindowAppRoutes(win, parseAppRoutes(paths))
	})
}

export function bindWindowMaximizeEvents(win: BrowserWindow): void {
	function send(): void {
		if (win.isDestroyed()) return
		win.webContents.send(IPC.windowMaximizedChanged, win.isMaximized())
	}
	win.on("maximize", send)
	win.on("unmaximize", send)
}

function windowFrom(
	event: IpcMainInvokeEvent | IpcMainEvent,
): BrowserWindow | undefined {
	return BrowserWindow.fromWebContents(event.sender) ?? undefined
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function isValidPort(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= 65535
	)
}

function isCloseAction(value: unknown): value is DesktopConfig["closeAction"] {
	return value === "ask" || value === "tray" || value === "quit"
}

const MAX_APP_ROUTES = 200
const MAX_ROUTE_LENGTH = 200

function parseAppRoutes(value: unknown): string[] {
	if (!Array.isArray(value)) return []
	const routes: string[] = []
	for (const entry of value) {
		if (
			typeof entry !== "string" ||
			entry.length === 0 ||
			entry.length > MAX_ROUTE_LENGTH ||
			!entry.startsWith("/")
		) {
			continue
		}
		routes.push(entry)
		if (routes.length >= MAX_APP_ROUTES) break
	}
	return routes
}

function isHttpUrl(url: string): boolean {
	try {
		const parsed = new URL(url)
		return parsed.protocol === "http:" || parsed.protocol === "https:"
	} catch {
		return false
	}
}

function isConfigPatch(
	value: unknown,
): value is Partial<
	Pick<DesktopConfig, "autoStart" | "startInTray" | "autoUpdate">
> {
	if (!isRecord(value)) return false
	for (const key of ["autoStart", "startInTray", "autoUpdate"] as const) {
		if (key in value && typeof value[key] !== "boolean") return false
	}
	return true
}

function isWizardResult(value: unknown): value is DesktopWizardResult {
	if (!isRecord(value)) return false
	return (
		typeof value.libraryPath === "string" &&
		value.libraryPath.length > 0 &&
		typeof value.autoStart === "boolean" &&
		typeof value.startInTray === "boolean"
	)
}

export async function pickDirectory(
	parent: BrowserWindow | undefined,
): Promise<string | undefined> {
	const result = parent
		? await dialog.showOpenDialog(parent, {
				properties: ["openDirectory", "createDirectory"],
			})
		: await dialog.showOpenDialog({
				properties: ["openDirectory", "createDirectory"],
			})
	if (result.canceled) return undefined
	return result.filePaths[0]
}

export function applyLoginItem(config: DesktopConfig): void {
	app.setLoginItemSettings({
		openAtLogin: config.autoStart,
		args: config.startInTray ? ["--hidden"] : [],
	})
}
