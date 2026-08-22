import type {
	DesktopCloseAction,
	DesktopShellConfig,
	DesktopUpdateState,
	DesktopWizardResult,
	HoardodileDesktopBridge,
	LanAddress,
	LanInfo,
} from "@hoardodile/shared/desktop"
import { contextBridge, ipcRenderer } from "electron"
import { IPC } from "../shared/ipc.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

function readPortable(): boolean {
	const raw: unknown = ipcRenderer.sendSync(IPC.configSync)
	return isRecord(raw) && raw.portable === true
}

function subscribeMaximized(
	listener: (maximized: boolean) => void,
): () => void {
	function onChanged(_event: unknown, maximized: unknown): void {
		if (typeof maximized === "boolean") listener(maximized)
	}
	ipcRenderer.on(IPC.windowMaximizedChanged, onChanged)
	return () => {
		ipcRenderer.off(IPC.windowMaximizedChanged, onChanged)
	}
}

function subscribeUpdates(
	listener: (state: DesktopUpdateState) => void,
): () => void {
	function onChanged(_event: unknown, state: unknown): void {
		if (isUpdateState(state)) listener(state)
	}
	ipcRenderer.on(IPC.updatesChanged, onChanged)
	return () => {
		ipcRenderer.off(IPC.updatesChanged, onChanged)
	}
}

function isUpdateState(value: unknown): value is DesktopUpdateState {
	if (!isRecord(value) || typeof value.status !== "string") return false
	switch (value.status) {
		case "idle":
		case "checking":
		case "latest":
			return true
		case "downloading":
			return typeof value.percent === "number"
		case "ready":
			return typeof value.version === "string"
		case "error":
			return typeof value.message === "string"
		default:
			return false
	}
}

function isValidPort(value: unknown): value is number {
	return (
		typeof value === "number" &&
		Number.isInteger(value) &&
		value >= 1 &&
		value <= 65535
	)
}

function isCloseAction(value: unknown): value is DesktopCloseAction {
	return value === "ask" || value === "tray" || value === "quit"
}

function parseLanInfo(value: unknown): LanInfo {
	if (!isRecord(value) || !Array.isArray(value.addresses)) {
		throw new Error("desktop LAN info unavailable")
	}
	const addresses: LanAddress[] = []
	for (const entry of value.addresses) {
		if (
			!isRecord(entry) ||
			typeof entry.interfaceName !== "string" ||
			typeof entry.address !== "string"
		) {
			throw new Error("desktop LAN info unavailable")
		}
		addresses.push({
			interfaceName: entry.interfaceName,
			address: entry.address,
		})
	}
	return {
		enabled: value.enabled === true,
		port: isValidPort(value.port) ? value.port : 0,
		preferredPort: isValidPort(value.preferredPort) ? value.preferredPort : 0,
		addresses,
	}
}

async function invokeUnknown(
	channel: string,
	...args: unknown[]
): Promise<unknown> {
	return await ipcRenderer.invoke(channel, ...args)
}

const bridge: HoardodileDesktopBridge = {
	isDesktop: true,
	platform: "desktop",
	minimize() {
		ipcRenderer.send(IPC.windowMinimize)
	},
	toggleMaximize() {
		ipcRenderer.send(IPC.windowToggleMaximize)
	},
	close() {
		ipcRenderer.send(IPC.windowClose)
	},
	retryLoad() {
		ipcRenderer.send(IPC.windowRetryLoad)
	},
	async isMaximized() {
		return (await invokeUnknown(IPC.windowIsMaximized)) === true
	},
	onMaximizedChange: subscribeMaximized,
	updates: {
		portable: readPortable(),
		async status() {
			const raw = await invokeUnknown(IPC.updatesStatus)
			return isUpdateState(raw) ? raw : { status: "idle" }
		},
		onStatus: subscribeUpdates,
		async check() {
			await invokeUnknown(IPC.updatesCheck)
		},
		async quitAndInstall() {
			await invokeUnknown(IPC.updatesQuitAndInstall)
		},
	},
	async pickLibraryFolder() {
		const raw = await invokeUnknown(IPC.pickLibraryFolder)
		return typeof raw === "string" ? raw : undefined
	},
	async relaunch() {
		await invokeUnknown(IPC.relaunch)
	},
	async getConfig() {
		const raw = await invokeUnknown(IPC.getConfig)
		if (
			!isRecord(raw) ||
			typeof raw.libraryPath !== "string" ||
			typeof raw.sharedFolderRoot !== "string" ||
			!isValidPort(raw.port)
		) {
			throw new Error("desktop config unavailable")
		}
		return {
			libraryPath: raw.libraryPath,
			sharedFolderRoot: raw.sharedFolderRoot,
			sharedFolderEnabled: raw.sharedFolderEnabled === true,
			port: raw.port,
			lanEnabled: raw.lanEnabled === true,
			autoStart: raw.autoStart === true,
			startInTray: raw.startInTray === true,
			closeAction: isCloseAction(raw.closeAction) ? raw.closeAction : "ask",
			autoUpdate: raw.autoUpdate === true,
			portable: raw.portable === true,
		} satisfies DesktopShellConfig
	},
	async setConfig(patch) {
		await invokeUnknown(IPC.setConfig, patch)
	},
	async setCloseAction(action) {
		await invokeUnknown(IPC.setCloseAction, action)
	},
	async closeWithAction(action, remember) {
		await invokeUnknown(IPC.closeWithAction, { action, remember })
	},
	async changeLibraryFolder(libraryPath) {
		await invokeUnknown(IPC.changeLibraryFolder, libraryPath)
	},
	async setSharedFolderRoot(sharedFolderRoot) {
		await invokeUnknown(IPC.setSharedFolderRoot, sharedFolderRoot)
	},
	async setSharedFolderEnabled(enabled) {
		await invokeUnknown(IPC.setSharedFolderEnabled, enabled)
	},
	async getLanInfo() {
		return parseLanInfo(await invokeUnknown(IPC.lanInfo))
	},
	async setLanEnabled(enabled) {
		await invokeUnknown(IPC.setLanEnabled, enabled)
	},
	async setLanPort(port) {
		await invokeUnknown(IPC.setLanPort, port)
	},
	async completeWizard(result: DesktopWizardResult) {
		await invokeUnknown(IPC.completeWizard, result)
	},
	async getWizardDefaults() {
		const raw = await invokeUnknown(IPC.wizardDefaults)
		if (!isRecord(raw) || typeof raw.libraryPath !== "string") {
			throw new Error("wizard defaults unavailable")
		}
		return { libraryPath: raw.libraryPath }
	},
}

contextBridge.exposeInMainWorld("hoardodileDesktop", bridge)
