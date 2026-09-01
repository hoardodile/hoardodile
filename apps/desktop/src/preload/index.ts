// Pure helper module (no catalogs) — keeps the sandboxed preload bundle free of the JSON catalogs.
import { isSupportedLanguage } from "@hoardodile/i18n/core"
import type {
	DesktopCloseAction,
	DesktopShellConfig,
	DesktopUpdateState,
	DesktopWizardResult,
	HoardodileDesktopBridge,
	LanAddress,
	LanInfo,
	LanSetResult,
} from "@hoardodile/shared/desktop"
import { contextBridge, ipcRenderer } from "electron"
import { IPC } from "../shared/ipc.ts"

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null && !Array.isArray(value)
}

/** One sync round-trip for the static facts the bridge needs at creation. */
function readSyncState(): {
	readonly portable: boolean
	readonly devtools: boolean
} {
	const raw: unknown = ipcRenderer.sendSync(IPC.configSync)
	return {
		portable: isRecord(raw) && raw.portable === true,
		devtools: isRecord(raw) && raw.devtools === true,
	}
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
		case "latest":
			return true
		case "checking":
			return isChannel(value.channel)
		case "downloading":
			return isChannel(value.channel) && typeof value.percent === "number"
		case "ready":
			return isChannel(value.channel) && typeof value.version === "string"
		case "applying":
			return (
				value.channel === "resources" &&
				(value.phase === "stopping" ||
					value.phase === "swapping" ||
					value.phase === "starting")
			)
		case "error":
			return typeof value.message === "string"
		default:
			return false
	}
}

function isChannel(value: unknown): value is "resources" | "full" {
	return value === "resources" || value === "full"
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
		https: value.https === true,
		port: isValidPort(value.port) ? value.port : 0,
		preferredPort: isValidPort(value.preferredPort) ? value.preferredPort : 0,
		lanPort: isValidPort(value.lanPort) ? value.lanPort : 0,
		lanPreferredPort: isValidPort(value.lanPreferredPort)
			? value.lanPreferredPort
			: 0,
		lanHttpsPort: isValidPort(value.lanHttpsPort) ? value.lanHttpsPort : 0,
		lanHttpsPreferredPort: isValidPort(value.lanHttpsPreferredPort)
			? value.lanHttpsPreferredPort
			: 0,
		fingerprint:
			typeof value.fingerprint === "string" ? value.fingerprint : undefined,
		addresses,
	}
}

function parseLanSetResult(value: unknown): LanSetResult {
	if (isRecord(value) && value.ok === true) return { ok: true }
	if (
		isRecord(value) &&
		(value.reason === "no-admin-password" ||
			value.reason === "weak-password-required")
	) {
		return { ok: false, reason: value.reason }
	}
	throw new Error("desktop LAN set result unavailable")
}

async function invokeUnknown(
	channel: string,
	...args: unknown[]
): Promise<unknown> {
	return await ipcRenderer.invoke(channel, ...args)
}

const syncState = readSyncState()

const bridge: HoardodileDesktopBridge = {
	isDesktop: true,
	platform: "desktop",
	minimize() {
		ipcRenderer.send(IPC.windowMinimize)
	},
	toggleMaximize() {
		ipcRenderer.send(IPC.windowToggleMaximize)
	},
	// Present only on unpackaged (dev) runs; the caption bar hides its
	// DevTools button when the bridge does not carry the control.
	...(syncState.devtools
		? {
				toggleDevtools() {
					ipcRenderer.send(IPC.windowToggleDevTools)
				},
			}
		: {}),
	close() {
		ipcRenderer.send(IPC.windowClose)
	},
	retryLoad() {
		ipcRenderer.send(IPC.windowRetryLoad)
	},
	// Route all non-app navigation through the shell: the main process
	// validates http(s) and hands the URL to the OS browser.
	openExternal(url: string) {
		ipcRenderer.send(IPC.openExternal, url)
	},
	// SPA route patterns (TanStack route tree full paths). The shell only
	// lets a same-origin navigation replace the app window when its
	// pathname matches one of these.
	registerAppRoutes(paths: readonly string[]) {
		ipcRenderer.send(IPC.appRoutes, paths)
	},
	async isMaximized() {
		return (await invokeUnknown(IPC.windowIsMaximized)) === true
	},
	onMaximizedChange: subscribeMaximized,
	updates: {
		portable: syncState.portable,
		async status() {
			const raw = await invokeUnknown(IPC.updatesStatus)
			return isUpdateState(raw) ? raw : { status: "idle" }
		},
		onStatus: subscribeUpdates,
		async check() {
			await invokeUnknown(IPC.updatesCheck)
		},
		async apply() {
			await invokeUnknown(IPC.updatesApply)
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
	async openLogsFolder() {
		const raw = await invokeUnknown(IPC.logsOpen)
		return raw === true
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
			requireSignInOnLaunch:
				raw.requireSignInOnLaunch === true ||
				// Missing on configs written before the setting existed: the
				// shell's parsed config already carries the default (true).
				raw.requireSignInOnLaunch === undefined,
			requireSignInOnWindowOpen:
				raw.requireSignInOnWindowOpen === true ||
				raw.requireSignInOnWindowOpen === undefined,
			autoUpdate: raw.autoUpdate === true,
			portable: raw.portable === true,
			resourceVersion:
				typeof raw.resourceVersion === "string" ? raw.resourceVersion : null,
		} satisfies DesktopShellConfig
	},
	async setConfig(patch) {
		await invokeUnknown(IPC.setConfig, patch)
	},
	async setCloseAction(action) {
		// Fire-and-forget like the other window commands: the main side
		// registers `ipcMain.on` for this channel, so `invoke` would fail
		// with "No handler registered".
		ipcRenderer.send(IPC.setCloseAction, action)
	},
	async closeWithAction(action, remember) {
		await invokeUnknown(IPC.closeWithAction, { action, remember })
	},
	// Fire-and-forget like the other window commands: the SPA pushes its
	// resolved language so shell pages and the native dialog can render
	// localized copy from the shared catalogs.
	setLanguage(language) {
		ipcRenderer.send(IPC.setLanguage, language)
	},
	async getLanguage() {
		const raw: unknown = await invokeUnknown(IPC.getLanguage)
		return typeof raw === "string" && isSupportedLanguage(raw) ? raw : undefined
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
	async checkLanEnabled() {
		return parseLanSetResult(await invokeUnknown(IPC.lanCheck))
	},
	async setLanEnabled(enabled, options) {
		return parseLanSetResult(
			await invokeUnknown(IPC.setLanEnabled, enabled, options),
		)
	},
	async setLanPort(port) {
		await invokeUnknown(IPC.setLanPort, port)
	},
	async setLanHttps(enabled) {
		await invokeUnknown(IPC.setLanHttps, enabled)
	},
	async getShellCacheSize() {
		const raw = await invokeUnknown(IPC.shellCacheSize)
		if (typeof raw !== "number" || !Number.isFinite(raw)) {
			throw new Error("desktop shell cache size unavailable")
		}
		return raw
	},
	async clearShellCache() {
		const raw = await invokeUnknown(IPC.shellCacheClear)
		if (typeof raw !== "number" || !Number.isFinite(raw)) {
			throw new Error("desktop shell cache clear failed")
		}
		return raw
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
