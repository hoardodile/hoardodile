import type {
	DesktopShellConfig,
	DesktopUpdateState,
	DesktopWizardResult,
	LanInfo,
} from "@hoardodile/shared/desktop"
import type { SupportedLanguage } from "@hoardodile/shared/i18n"
import { isSupportedLanguage } from "@hoardodile/shared/i18n"
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
	setLanEnabled: (enabled: boolean) => Promise<void>
	setLanPort: (port: number) => Promise<void>
	shellCacheSize: () => Promise<number>
	shellCacheClear: () => Promise<number>
	completeWizard: (result: DesktopWizardResult) => void
	defaultLibraryPath: () => string
	updateStatus: () => DesktopUpdateState
	checkUpdates: () => Promise<void>
	quitAndInstall: () => Promise<void>
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
		if (typeof language !== "string" || !isSupportedLanguage(language)) return
		host.setLanguage(language)
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
		}
	})
	ipcMain.on(IPC.configSync, (event) => {
		event.returnValue = { portable: host.portable() }
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
	ipcMain.handle(IPC.setLanEnabled, (_event, enabled: unknown) => {
		if (typeof enabled !== "boolean") return
		return host.setLanEnabled(enabled)
	})
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
