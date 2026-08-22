import { existsSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type {
	DesktopUpdateState,
	DesktopWizardResult,
	LanInfo,
} from "@hoardodile/shared/desktop"
import type { SupportedLanguage } from "@hoardodile/shared/i18n"
import en from "@hoardodile/shared/i18n/en.json"
import zh from "@hoardodile/shared/i18n/zh.json"
import {
	app,
	BrowserWindow,
	clipboard,
	dialog,
	Notification,
	type Tray,
} from "electron"
import { HIDDEN_SWITCH, IPC } from "../shared/ipc.ts"
import {
	configFilePath,
	type DesktopConfig,
	readDesktopConfig,
	writeDesktopConfig,
} from "./config.ts"
import { bindDestApiProxy } from "./dest-api-proxy.ts"
import { DEV_SERVER_ERROR_MESSAGE, SERVER_ERROR_MESSAGE } from "./error-page.ts"
import {
	applyLoginItem,
	bindWindowMaximizeEvents,
	pickDirectory,
	registerIpc,
} from "./ipc.ts"
import { computeLanAddresses, lanUrlFor } from "./lan.ts"
import {
	findWorkspaceRoot,
	packagedLayout,
	type SidecarLayout,
	workspaceLayout,
} from "./paths.ts"
import {
	patchSidecarSharedFolder,
	readSidecarAuthConfigured,
	type SidecarHandle,
	startSidecar,
} from "./sidecar.ts"
import {
	createAppTray,
	rebuildTrayMenu,
	trayIconPath,
	windowIconPath,
} from "./tray.ts"
import { startUpdater, type UpdaterHandle } from "./updater.ts"
import { isHttpReachable } from "./urls.ts"
import {
	createDesktopWindow,
	loadShellPage,
	preloadPath,
	type ShellPageTarget,
} from "./window.ts"

const HEALTH_LOG_LIMIT = 200_000

type Runtime = {
	config: DesktopConfig
	configPath: string
	layout: SidecarLayout
	desktopRoot: string
	defaultLibraryPath: string
	portable: boolean
	sidecar: SidecarHandle | undefined
	window: BrowserWindow | undefined
	wizard: BrowserWindow | undefined
	tray: Tray | undefined
	updater: UpdaterHandle | undefined
	crashed: boolean
	updateReady: boolean
	quitting: boolean
	/** UI language pushed by the SPA; shell pages and the native ask dialog fall back to it (undefined until pushed). */
	language: SupportedLanguage | undefined
	iconPath: string | undefined
	completeWizard: ((result: DesktopWizardResult) => void) | undefined
}

let activeRuntime: Runtime | undefined

const here = dirname(fileURLToPath(import.meta.url))

function desktopRootFromMain(): string {
	// out/main/index.js → apps/desktop
	return join(here, "..", "..")
}

function isPortableBuild(): boolean {
	if (!app.isPackaged) return false
	if (process.env.PORTABLE_EXECUTABLE_DIR !== undefined) return true
	const uninstaller = join(
		dirname(process.execPath),
		`Uninstall ${app.getName()}.exe`,
	)
	return !existsSync(uninstaller)
}

function resolveLayout(root: string): SidecarLayout {
	if (app.isPackaged) return packagedLayout(process.resourcesPath)
	const workspaceRoot =
		process.env.HOARDODILE_WORKSPACE ?? findWorkspaceRoot(root)
	const nodePath = process.env.npm_node_execpath ?? "node"
	const viteNodeCli = resolveViteNodeCli(workspaceRoot)
	return workspaceLayout({ workspaceRoot, nodePath, viteNodeCli })
}

function resolveViteNodeCli(workspaceRoot: string): string {
	const candidates = [
		join(workspaceRoot, "node_modules", "vite-node", "dist", "cli.mjs"),
		join(workspaceRoot, "node_modules", "vite-node", "vite-node.mjs"),
	]
	for (const candidate of candidates) {
		if (existsSync(candidate)) return candidate
	}
	throw new Error("vite-node CLI not found; run pnpm install in the workspace")
}

function persist(runtime: Runtime): void {
	writeDesktopConfig(runtime.configPath, runtime.config)
}

function broadcastUpdate(runtime: Runtime, state: DesktopUpdateState): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send(IPC.updatesChanged, state)
	}
	if (runtime.tray !== undefined) {
		rebuildTrayMenu(runtime.tray, trayHandlers(runtime), {
			crashed: runtime.crashed,
			updateReady: runtime.updateReady,
			lanUrl: lanTrayUrl(runtime),
		})
	}
}

function trayHandlers(runtime: Runtime) {
	return {
		openWindow() {
			void openAppWindow(runtime)
		},
		changeLibrary() {
			void changeLibraryFromTray(runtime)
		},
		quit() {
			void quitApp(runtime)
		},
		restartSidecar() {
			void restartSidecar(runtime)
		},
		copyLanAddress() {
			copyLanAddress(runtime)
		},
	}
}

async function changeLibraryFromTray(runtime: Runtime): Promise<void> {
	const next = await pickDirectory(runtime.window)
	if (next === undefined || next === runtime.config.libraryPath) return
	await changeLibrary(runtime, next)
}

async function changeLibrary(
	runtime: Runtime,
	libraryPath: string,
): Promise<void> {
	runtime.config = { ...runtime.config, libraryPath }
	persist(runtime)
	await relaunchApp(runtime)
}

async function setSharedFolder(
	runtime: Runtime,
	sharedFolderRoot: string,
): Promise<void> {
	if (sharedFolderRoot === runtime.config.sharedFolderRoot) return
	if (runtime.config.sharedFolderEnabled) {
		const sidecar = runtime.sidecar
		if (sidecar === undefined) {
			throw new Error("sidecar is not running")
		}
		await patchSidecarSharedFolder(sidecar, sharedFolderRoot)
	}
	runtime.config = { ...runtime.config, sharedFolderRoot }
	persist(runtime)
}

async function setSharedFolderEnabled(
	runtime: Runtime,
	enabled: boolean,
): Promise<void> {
	if (enabled === runtime.config.sharedFolderEnabled) return
	const sidecar = runtime.sidecar
	if (sidecar === undefined) {
		throw new Error("sidecar is not running")
	}
	if (enabled) {
		await patchSidecarSharedFolder(sidecar, runtime.config.sharedFolderRoot)
	} else {
		await patchSidecarSharedFolder(sidecar, null)
	}
	runtime.config = { ...runtime.config, sharedFolderEnabled: enabled }
	persist(runtime)
}

function lanInfo(runtime: Runtime): LanInfo {
	return {
		enabled: runtime.config.lanEnabled,
		port: runtime.config.port,
		preferredPort: runtime.config.portPreferred,
		addresses: computeLanAddresses(),
	}
}

/**
 * Enable or disable local-network sharing. The bind host changes at
 * `listen()` time, so the sidecar restarts in place; the app window is
 * kept and reloaded (production) or left alone (dev, proxy target
 * already rebound by `spawnSidecar`).
 */
async function setLanEnabled(
	runtime: Runtime,
	enabled: boolean,
): Promise<void> {
	if (enabled === runtime.config.lanEnabled) return
	const sidecar = runtime.sidecar
	if (sidecar === undefined) {
		throw new Error("sidecar is not running")
	}
	if (enabled) {
		const state = await readSidecarAuthConfigured(sidecar)
		if (!state.configured) {
			dialog.showErrorBox(
				"hoardodile",
				"Set an admin password first before enabling local network access.",
			)
			throw new Error(
				"refusing to enable LAN sharing without an admin password",
			)
		}
		if (state.weakPassword) {
			const { response } = await dialog.showMessageBox({
				type: "warning",
				title: "hoardodile",
				message: "Your admin password is weak.",
				detail:
					"Anyone on your network who guesses it can access the " +
					"whole library. Set a stronger password in Settings → " +
					"Change password first, or enable sharing anyway.",
				buttons: ["Enable sharing anyway", "Cancel"],
				defaultId: 1,
				cancelId: 1,
			})
			if (response !== 0) {
				throw new Error(
					"refusing to enable LAN sharing with a weak admin password",
				)
			}
		}
	}
	await applyLanChange(runtime, { lanEnabled: enabled })
}

/**
 * Change the sidecar port (localhost and the LAN share use one port) and
 * restart in place. The requested port is remembered separately so the
 * UI can keep showing it even when a conflict fallback moved the actual
 * listening port.
 */
async function setLanPort(runtime: Runtime, port: number): Promise<void> {
	if (port === runtime.config.portPreferred) return
	if (runtime.sidecar === undefined) {
		throw new Error("sidecar is not running")
	}
	await applyLanChange(runtime, { port, portPreferred: port })
}

async function applyLanChange(
	runtime: Runtime,
	patch: Partial<Pick<DesktopConfig, "lanEnabled" | "port" | "portPreferred">>,
): Promise<void> {
	const previous = runtime.config
	runtime.config = { ...runtime.config, ...patch }
	persist(runtime)
	let handle: SidecarHandle
	try {
		await runtime.sidecar?.stop()
		handle = await spawnSidecar(runtime)
	} catch (err) {
		runtime.config = previous
		persist(runtime)
		runtime.crashed = true
		runtime.window?.destroy()
		runtime.window = undefined
		rebuildSidecarTray(runtime)
		const message = err instanceof Error ? err.message : String(err)
		dialog.showErrorBox("hoardodile", `Server failed to start:\n${message}`)
		throw err
	}
	runtime.sidecar = handle
	runtime.crashed = false
	rebuildSidecarTray(runtime)
	const win = runtime.window
	if (win !== undefined && !win.isDestroyed()) {
		// Dev loads the Vite URL directly and the proxy already rebinds
		// to the new sidecar URL; production pages come from the sidecar
		// and die with it, so reload from the fresh URL — spinner first,
		// then the app (or the error page if it still fails).
		if (process.env.HOARDODILE_WEB_URL === undefined) {
			try {
				await loadShellPage(win, shellPageTarget(runtime), "loading")
				await win.loadURL(handle.url)
			} catch {
				await loadShellPage(
					win,
					shellPageTarget(runtime),
					"error",
					SERVER_ERROR_MESSAGE,
				)
			}
		}
	}
}

function rebuildSidecarTray(runtime: Runtime): void {
	if (runtime.tray === undefined) return
	rebuildTrayMenu(runtime.tray, trayHandlers(runtime), {
		crashed: runtime.crashed,
		updateReady: runtime.updateReady,
		lanUrl: lanTrayUrl(runtime),
	})
}

/** The URL the tray copies, using the actual listening port. */
function lanTrayUrl(runtime: Runtime): string | undefined {
	return lanUrlFor(
		runtime.config.lanEnabled,
		runtime.config.port,
		computeLanAddresses(),
	)
}

function copyLanAddress(runtime: Runtime): void {
	const url = lanTrayUrl(runtime)
	if (url === undefined) return
	clipboard.writeText(url)
	new Notification({
		title: "hoardodile",
		body: "LAN address copied to the clipboard.",
	}).show()
}

async function relaunchApp(runtime: Runtime): Promise<void> {
	runtime.quitting = true
	await runtime.sidecar?.stop()
	app.relaunch()
	app.quit()
}

async function quitApp(runtime: Runtime): Promise<void> {
	runtime.quitting = true
	await runtime.sidecar?.stop()
	app.quit()
}

async function restartSidecar(runtime: Runtime): Promise<void> {
	runtime.window?.destroy()
	runtime.window = undefined
	try {
		runtime.sidecar = await spawnSidecar(runtime)
		runtime.crashed = false
		if (runtime.tray !== undefined) {
			rebuildTrayMenu(runtime.tray, trayHandlers(runtime), {
				crashed: false,
				updateReady: runtime.updateReady,
				lanUrl: lanTrayUrl(runtime),
			})
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		dialog.showErrorBox("hoardodile", `Server failed to start:\n${message}`)
	}
}

async function spawnSidecar(runtime: Runtime): Promise<SidecarHandle> {
	const handle = await startSidecar({
		layout: runtime.layout,
		config: runtime.config,
		persistPort(port) {
			runtime.config = { ...runtime.config, port }
			persist(runtime)
		},
		log(chunk) {
			if (chunk.length > HEALTH_LOG_LIMIT) return
			process.stdout.write(chunk)
		},
	})
	handle.onCrash(() => {
		onSidecarCrash(runtime)
	})
	bindDestApiProxy({
		packaged: app.isPackaged,
		spaUrl: process.env.HOARDODILE_WEB_URL,
		sidecarUrl: handle.url,
	})
	return handle
}

function onSidecarCrash(runtime: Runtime): void {
	if (runtime.quitting) return
	runtime.crashed = true
	runtime.window?.destroy()
	runtime.window = undefined
	if (runtime.tray !== undefined) {
		rebuildTrayMenu(runtime.tray, trayHandlers(runtime), {
			crashed: true,
			updateReady: runtime.updateReady,
			lanUrl: lanTrayUrl(runtime),
		})
	}
	new Notification({
		title: "hoardodile",
		body: "The server stopped. Use Restart server from the tray.",
	}).show()
}

/**
 * Resolve the URL the app window should load: the Vite dev server in
 * dev, the sidecar otherwise. `undefined` (dev, Vite down) means the
 * caller shows the in-window error page; the old modal Retry dialog is
 * gone in favour of that page's Retry button.
 */
async function resolveAppUrl(runtime: Runtime): Promise<string | undefined> {
	const spaUrl = process.env.HOARDODILE_WEB_URL
	if (!app.isPackaged && spaUrl !== undefined && spaUrl.length > 0) {
		if (await isHttpReachable(spaUrl)) return spaUrl
		return undefined
	}
	if (runtime.sidecar === undefined) {
		throw new Error("sidecar is not running")
	}
	return runtime.sidecar.url
}

async function openAppWindow(runtime: Runtime): Promise<void> {
	if (runtime.crashed || runtime.sidecar === undefined) {
		const { response } = await dialog.showMessageBox({
			type: "warning",
			title: "hoardodile",
			message: "The server is not running.",
			buttons: ["Restart server", "Cancel"],
			defaultId: 0,
			cancelId: 1,
		})
		if (response === 0) await restartSidecar(runtime)
		if (runtime.sidecar === undefined) return
	}
	if (runtime.window !== undefined && !runtime.window.isDestroyed()) {
		runtime.window.focus()
		return
	}
	const url = await resolveAppUrl(runtime)
	const win = createDesktopWindow({
		preloadPath: preloadPath(runtime.desktopRoot),
		kind: "app",
		url: url ?? "about:blank",
		iconPath: runtime.iconPath,
		shellPage: shellPageTarget(runtime),
	})
	bindWindowMaximizeEvents(win)
	win.on("closed", () => {
		if (runtime.window === win) runtime.window = undefined
	})
	// Close guard: the caption close button, Alt+F4 and the taskbar close
	// all land here so the configured close action (ask / tray / quit) is
	// applied consistently. The wizard window has no guard.
	// `runtime.quitting` is the escape hatch: quitApp/relaunchApp/quitAndInstall
	// stop the sidecar and call `app.quit()`, whose window-close pass must
	// not be intercepted again — otherwise the guard re-enters quitApp and
	// the app never quits (a tight loop, the window looks frozen).
	let closeRequested = false
	win.on("close", (event) => {
		if (runtime.quitting || closeRequested || win.isDestroyed()) return
		event.preventDefault()
		void handleWindowCloseRequest(runtime, win, () => {
			closeRequested = true
			win.close()
		})
	})
	runtime.window = win
	if (url === undefined) {
		// Dev only: the Vite SPA is down. The in-window error page carries
		// the Retry button, so the shell's old Retry dialog is gone — one
		// mechanism for every load failure, dev or production.
		await loadShellPage(
			win,
			shellPageTarget(runtime),
			"error",
			DEV_SERVER_ERROR_MESSAGE,
		)
		return
	}
	// Spinner first, then the app: the window is never a blank white canvas
	// while the page loads (ready-to-show fires on the loading page).
	await loadShellPage(win, shellPageTarget(runtime), "loading")
	await win.loadURL(url)
}

/** Localized close-confirm copy for the native dialog; the SPA pushes the language via the bridge. */
function closeDialogStrings(language: SupportedLanguage | undefined) {
	const catalog = language === "zh" ? zh : en
	return {
		title: catalog.me.desktop.closeConfirm.title,
		description: catalog.me.desktop.closeConfirm.description,
		tray: catalog.me.desktop.closeConfirm.tray,
		quit: catalog.me.desktop.closeConfirm.quit,
		cancel: catalog.common.cancel,
		remember: catalog.me.desktop.closeConfirm.remember,
	}
}

/**
 * The app-window close guard. Applies the configured close action:
 * hide to tray, quit the app, or ask each time. The ask dialog carries a
 * "Remember my choice" checkbox that persists the selection — the same
 * setting the app settings page exposes directly.
 */
async function handleWindowCloseRequest(
	runtime: Runtime,
	win: BrowserWindow,
	finishClose: () => void,
): Promise<void> {
	switch (runtime.config.closeAction) {
		case "tray":
			finishClose()
			return
		case "quit":
			await quitApp(runtime)
			return
		case "ask": {
			const strings = closeDialogStrings(runtime.language)
			const { response, checkboxChecked } = await dialog.showMessageBox(win, {
				type: "question",
				title: "hoardodile",
				message: strings.title,
				detail: strings.description,
				buttons: [strings.tray, strings.quit, strings.cancel],
				defaultId: 0,
				cancelId: 2,
				checkboxLabel: strings.remember,
			})
			if (response === 2) return
			if (checkboxChecked) {
				runtime.config = {
					...runtime.config,
					closeAction: response === 1 ? "quit" : "tray",
				}
				persist(runtime)
			}
			if (response === 1) {
				await quitApp(runtime)
			} else {
				finishClose()
			}
		}
	}
}

/**
 * The error page's Retry button: show the loading page (its button already
 * switched to a spinner), re-resolve the app URL (Vite in dev, the sidecar
 * otherwise) and reload; on failure the window's own `did-fail-load` guard
 * swaps in a fresh error page.
 */
async function retryAppWindow(runtime: Runtime): Promise<void> {
	const win = runtime.window
	if (win === undefined || win.isDestroyed()) {
		await openAppWindow(runtime)
		return
	}
	await loadShellPage(win, shellPageTarget(runtime), "loading")
	let url: string | undefined
	try {
		url = await resolveAppUrl(runtime)
	} catch {
		// sidecar is undefined (e.g. it crashed while the window was
		// still open) — surface the generic error page instead of failing
		// silently.
		await loadShellPage(
			win,
			shellPageTarget(runtime),
			"error",
			SERVER_ERROR_MESSAGE,
		)
		return
	}
	if (url === undefined) {
		await loadShellPage(
			win,
			shellPageTarget(runtime),
			"error",
			DEV_SERVER_ERROR_MESSAGE,
		)
		return
	}
	try {
		await win.loadURL(url)
	} catch {
		// did-fail-load guard already swapped in the error page
	}
}

function focusWizardIfOpen(runtime: Runtime): boolean {
	const wizard = runtime.wizard
	if (wizard === undefined || wizard.isDestroyed()) return false
	if (wizard.isMinimized()) wizard.restore()
	wizard.show()
	wizard.focus()
	return true
}

function wizardUrl(runtime: Runtime): { url: string; wizardFile: string } {
	const destUrl = process.env.ELECTRON_WIZARD_URL
	return {
		url: destUrl !== undefined && destUrl.length > 0 ? destUrl : "",
		wizardFile: join(runtime.desktopRoot, "out", "wizard", "index.html"),
	}
}

function shellPageTarget(runtime: Runtime): ShellPageTarget {
	const target = wizardUrl(runtime)
	return { url: target.url, file: target.wizardFile }
}

function runWizard(runtime: Runtime): Promise<DesktopWizardResult> {
	return new Promise((resolve, reject) => {
		const target = wizardUrl(runtime)
		const win = createDesktopWindow({
			preloadPath: preloadPath(runtime.desktopRoot),
			kind: "wizard",
			url: target.url.length > 0 ? target.url : "about:blank",
			wizardFile: target.wizardFile,
			iconPath: runtime.iconPath,
		})
		bindWindowMaximizeEvents(win)
		runtime.wizard = win
		let settled = false
		function finish(result: DesktopWizardResult): void {
			if (settled) return
			settled = true
			if (!win.isDestroyed()) win.destroy()
			runtime.wizard = undefined
			resolve(result)
		}
		win.on("closed", () => {
			runtime.wizard = undefined
			if (!settled) {
				settled = true
				reject(new Error("wizard closed"))
			}
		})
		runtime.completeWizard = finish
	})
}

async function boot(): Promise<void> {
	const desktopRoot = desktopRootFromMain()
	const documentsPath = app.getPath("documents")
	const defaultLibraryPath = join(documentsPath, "hoardodile")
	const configPath = configFilePath(app.getPath("userData"))
	const runtime: Runtime = {
		config: readDesktopConfig(configPath, defaultLibraryPath, documentsPath),
		configPath,
		layout: resolveLayout(desktopRoot),
		desktopRoot,
		defaultLibraryPath,
		portable: isPortableBuild(),
		sidecar: undefined,
		window: undefined,
		wizard: undefined,
		tray: undefined,
		updater: undefined,
		crashed: false,
		updateReady: false,
		quitting: false,
		language: undefined,
		iconPath: undefined,
		completeWizard: undefined,
	}
	activeRuntime = runtime
	runtime.iconPath = windowIconPath(
		app.isPackaged ? process.resourcesPath : runtime.desktopRoot,
	)

	registerIpc({
		getConfig: () => runtime.config,
		portable: () => runtime.portable,
		pickLibraryFolder: (parent) => pickDirectory(parent),
		relaunch: () => relaunchApp(runtime),
		retryLoad: () => {
			void retryAppWindow(runtime)
		},
		setCloseAction(action) {
			runtime.config = { ...runtime.config, closeAction: action }
			persist(runtime)
		},
		async closeWithAction(action, remember) {
			if (remember && runtime.config.closeAction !== action) {
				runtime.config = { ...runtime.config, closeAction: action }
				persist(runtime)
			}
			if (action === "quit") {
				await quitApp(runtime)
				return
			}
			// Hide to tray: destroy is intentional — it skips the close
			// guard (the renderer already decided) and the app keeps
			// running under the tray with the session intact.
			runtime.window?.destroy()
		},
		setLanguage(language) {
			runtime.language = language
		},
		getLanguage: () => Promise.resolve(runtime.language),
		patchConfig(patch) {
			runtime.config = { ...runtime.config, ...patch }
			persist(runtime)
			applyLoginItem(runtime.config)
			if (patch.autoUpdate !== undefined) {
				runtime.updater?.setEnabled(patch.autoUpdate && !runtime.portable)
			}
		},
		changeLibraryFolder: (libraryPath) => changeLibrary(runtime, libraryPath),
		setSharedFolderRoot: (sharedFolderRoot) =>
			setSharedFolder(runtime, sharedFolderRoot),
		setSharedFolderEnabled: (enabled) =>
			setSharedFolderEnabled(runtime, enabled),
		lanInfo: () => lanInfo(runtime),
		setLanEnabled: (enabled) => setLanEnabled(runtime, enabled),
		setLanPort: (port) => setLanPort(runtime, port),
		completeWizard(result) {
			runtime.completeWizard?.(result)
		},
		defaultLibraryPath: () => runtime.defaultLibraryPath,
		updateStatus: () => runtime.updater?.status() ?? { status: "idle" },
		checkUpdates: () => runtime.updater?.check() ?? Promise.resolve(),
		async quitAndInstall() {
			runtime.quitting = true
			await runtime.sidecar?.stop()
			runtime.updater?.quitAndInstall()
		},
	})

	if (!runtime.config.wizardComplete) {
		try {
			const result = await runWizard(runtime)
			runtime.config = {
				...runtime.config,
				wizardComplete: true,
				libraryPath: result.libraryPath,
				autoStart: result.autoStart,
				startInTray: result.startInTray,
			}
			persist(runtime)
			applyLoginItem(runtime.config)
		} catch {
			app.quit()
			return
		}
	}

	applyLoginItem(runtime.config)

	try {
		runtime.sidecar = await spawnSidecar(runtime)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		dialog.showErrorBox("hoardodile", `Server failed to start:\n${message}`)
		runtime.crashed = true
	}

	runtime.tray = createAppTray(
		trayIconPath(app.isPackaged ? process.resourcesPath : runtime.desktopRoot),
		trayHandlers(runtime),
		{
			crashed: runtime.crashed,
			updateReady: runtime.updateReady,
		},
	)

	runtime.updater = startUpdater({
		enabled: runtime.config.autoUpdate && !runtime.portable,
		portable: runtime.portable,
		onReady() {
			runtime.updateReady = true
			broadcastUpdate(runtime, runtime.updater?.status() ?? { status: "idle" })
		},
	})
	runtime.updater.onStatus((state) => {
		broadcastUpdate(runtime, state)
	})

	const hiddenLaunch =
		process.argv.includes(HIDDEN_SWITCH) ||
		(app.getLoginItemSettings().wasOpenedAtLogin && runtime.config.startInTray)

	if (
		!hiddenLaunch &&
		!runtime.config.startInTray &&
		runtime.sidecar !== undefined
	) {
		await openAppWindow(runtime)
	}
}

const gotLock = app.requestSingleInstanceLock()
if (!gotLock) {
	app.quit()
} else {
	app.setAppUserModelId("com.hoardodile.app")
	app.on("second-instance", (_event, argv) => {
		if (argv.includes(HIDDEN_SWITCH)) return
		if (activeRuntime === undefined) return
		if (focusWizardIfOpen(activeRuntime)) return
		void openAppWindow(activeRuntime)
	})
	app.on("window-all-closed", () => {
		// Tray keeps the process alive on Windows.
	})
	app.on("before-quit", (event) => {
		if (activeRuntime === undefined || activeRuntime.quitting) return
		event.preventDefault()
		void quitApp(activeRuntime)
	})
	app.whenReady().then(() => {
		void boot()
	})
}
