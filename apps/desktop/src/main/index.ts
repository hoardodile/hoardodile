import { existsSync, mkdirSync, readFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { fileURLToPath } from "node:url"
import type { SupportedLanguage } from "@hoardodile/i18n"
import { resolveSystemLanguage } from "@hoardodile/i18n"
import { shellCatalogFor } from "@hoardodile/i18n/catalogs/shell"
import type {
	DesktopUpdateState,
	DesktopWizardResult,
	LanCheckResult,
	LanInfo,
	LanSetResult,
} from "@hoardodile/shared/desktop"
import {
	app,
	BrowserWindow,
	dialog,
	Notification,
	session,
	shell,
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
import { devServerErrorMessage, serverErrorMessage } from "./error-page.ts"
import {
	applyLoginItem,
	bindWindowMaximizeEvents,
	pickDirectory,
	registerIpc,
} from "./ipc.ts"
import { computeLanAddresses } from "./lan.ts"
import {
	findWorkspaceRoot,
	packagedLayout,
	type SidecarLayout,
	workspaceLayout,
} from "./paths.ts"
import { applyDesktopProxy } from "./proxy.ts"
import { resourceUpdateSupport } from "./resource-support.ts"
import { startResourceChannel } from "./resource-updater.ts"
import { recoverAtBoot } from "./resources-swap.ts"
import { clearSessionCookies } from "./session-cookie.ts"
import {
	clearShellCache,
	getShellCacheSize,
	platformCacheBase,
	resolveUpdaterCacheDir,
} from "./shell-cache.ts"
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
import {
	startUpdateManager,
	type UpdateManagerHandle,
} from "./update-manager.ts"
import { startFullUpdater } from "./updater.ts"
import { isHttpReachable } from "./urls.ts"
import {
	createDesktopWindow,
	loadShellPage,
	preloadPath,
	type ShellPageTarget,
} from "./window.ts"
import { captureBounds } from "./window-state.ts"

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
	updater: UpdateManagerHandle | undefined
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
	if (process.platform !== "win32") {
		// AppImages and .app bundles are "installed" shapes: portable
		// (no updater) is a Windows zip concept.
		return false
	}
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

const WINDOW_STATE_DEBOUNCE_MS = 400
const windowStateTimers = new WeakMap<
	BrowserWindow,
	ReturnType<typeof setTimeout>
>()

/**
 * Persist the app window's normal-state bounds + maximized flag
 * (debounced — a drag-resize floods `resize`/`move`). `close` flushes
 * synchronously (it also covers quit/relaunch, whose `app.quit()` pass
 * closes the window through this event), and every intentional `destroy`
 * (tray hide, sidecar crash, LAN failure) must flush first: `destroy()`
 * skips `close`, so the debounce would otherwise lose the last geometry.
 */
function scheduleWindowStatePersist(
	runtime: Runtime,
	win: BrowserWindow,
): void {
	const existing = windowStateTimers.get(win)
	if (existing !== undefined) clearTimeout(existing)
	windowStateTimers.set(
		win,
		setTimeout(() => {
			windowStateTimers.delete(win)
			flushWindowState(runtime, win)
		}, WINDOW_STATE_DEBOUNCE_MS),
	)
}

function flushWindowState(
	runtime: Runtime,
	win: BrowserWindow | undefined,
): void {
	if (win === undefined || win.isDestroyed()) return
	const timer = windowStateTimers.get(win)
	if (timer !== undefined) {
		clearTimeout(timer)
		windowStateTimers.delete(win)
	}
	runtime.config = {
		...runtime.config,
		windowBounds: captureBounds(win),
		windowMaximized: win.isMaximized(),
	}
	// Window-state persistence must never take the shell down: a failing
	// write here runs from the resize debounce timer and the `close`
	// event — an uncaught throw would crash the main process (or leave
	// the window un-closable when the IPC handler inline-flushes).
	try {
		persist(runtime)
	} catch (err) {
		console.error(
			`[desktop] failed to persist window state: ${
				err instanceof Error ? err.message : String(err)
			}`,
		)
	}
}

function broadcastUpdate(runtime: Runtime, state: DesktopUpdateState): void {
	for (const win of BrowserWindow.getAllWindows()) {
		if (!win.isDestroyed()) win.webContents.send(IPC.updatesChanged, state)
	}
	if (runtime.tray !== undefined) {
		rebuildTrayMenu(
			runtime.tray,
			trayHandlers(runtime),
			{
				crashed: runtime.crashed,
				updateReady: runtime.updateReady,
				updateReadyResources:
					state.status === "ready" && state.channel === "resources",
			},
			trayStrings(runtime.language),
		)
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

/** electron-updater's download cache dir (platform cache base, see shell-cache.ts). */
function updaterCacheDir(): string {
	return resolveUpdaterCacheDir({
		platformBase: platformCacheBase(process.platform),
		appName: app.getName(),
	})
}

/**
 * The updater cache must keep its package while a download runs or an
 * update sits ready to install (quitAndInstall reads it back).
 */
function updaterCacheClearable(runtime: Runtime): boolean {
	const state = runtime.updater?.status() ?? { status: "idle" }
	return state.status !== "downloading" && state.status !== "ready"
}

/**
 * The resources-version marker every installer and resource pack ships
 * at `resources/resources-version.json`: which payload tree is on disk
 * RIGHT NOW. Once the sidecar is up we cannot tell from the code, so
 * this is the reconciliation source of truth at boot.
 */
function readResourcesMarker(
	resourcesRoot: string,
): { version: string } | undefined {
	try {
		const raw: unknown = JSON.parse(
			readFileSync(join(resourcesRoot, "resources-version.json"), "utf8"),
		)
		if (
			typeof raw === "object" &&
			raw !== null &&
			!Array.isArray(raw) &&
			typeof (raw as Record<string, unknown>).version === "string"
		) {
			return { version: (raw as { version: string }).version }
		}
	} catch {
		// no marker (pre-resource-channel installs): leave reconciliation alone
	}
	return undefined
}

/**
 * Probe whether local-network sharing could be enabled right now: no
 * admin password, or a weak one that needs the user's explicit consent.
 * Never restarts anything — the renderer probes first so a required
 * confirm dialog can appear before any loading state.
 */
async function checkLanEnabled(runtime: Runtime): Promise<LanCheckResult> {
	const sidecar = runtime.sidecar
	if (sidecar === undefined) {
		throw new Error("sidecar is not running")
	}
	const state = await readSidecarAuthConfigured(sidecar)
	if (!state.configured) return { ok: false, reason: "no-admin-password" }
	if (state.weakPassword) return { ok: false, reason: "weak-password-required" }
	return { ok: true }
}

/**
 * Enable or disable local-network sharing. The bind host changes at
 * `listen()` time, so the sidecar restarts in place; the app window is
 * kept and reloaded (production) or left alone (dev, proxy target
 * already rebound by `spawnSidecar`).
 *
 * Enabling can be declined without an error: no admin password (LAN must
 * never expose an unclaimed instance) or a weak admin password that the
 * user has not confirmed yet — the renderer shows the in-app confirm
 * dialog and retries with `weakPasswordConfirmed: true`. The password is
 * re-checked on every call, so the flag is only ever UX consent. Genuine
 * failures (sidecar down, restart failed) still reject.
 */
async function setLanEnabled(
	runtime: Runtime,
	enabled: boolean,
	weakPasswordConfirmed: boolean,
): Promise<LanSetResult> {
	if (enabled === runtime.config.lanEnabled) return { ok: true }
	const sidecar = runtime.sidecar
	if (sidecar === undefined) {
		throw new Error("sidecar is not running")
	}
	if (enabled) {
		const check = await checkLanEnabled(runtime)
		if (!check.ok) {
			if (check.reason === "no-admin-password") {
				// The native box is only for the case the renderer cannot
				// explain without a restart attempt; weak consent stays in-app.
				const catalog = shellCatalogFor(runtime.language)
				dialog.showErrorBox(
					"hoardodile",
					catalog.desktopShell.dialog.lanPasswordRequired,
				)
				return check
			}
			// Weak password: only the renderer-confirmed retry proceeds.
			if (!weakPasswordConfirmed) return check
		}
	}
	await applyLanChange(runtime, { lanEnabled: enabled })
	return { ok: true }
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
		const win = runtime.window
		if (win !== undefined) {
			flushWindowState(runtime, win)
			win.destroy()
		}
		runtime.window = undefined
		rebuildSidecarTray(runtime)
		const message = err instanceof Error ? err.message : String(err)
		dialog.showErrorBox(
			"hoardodile",
			shellCatalogFor(
				runtime.language,
			).desktopShell.dialog.serverFailedToStart.replace(
				"{{message}}",
				() => message,
			),
		)
		throw err
	}
	runtime.sidecar = handle
	runtime.crashed = false
	rebuildSidecarTray(runtime)
	const win = runtime.window
	if (win !== undefined && !win.isDestroyed()) {
		// Dev loads the Vite URL directly and the proxy already rebinds
		// to the new sidecar URL; production pages come from the sidecar
		// and die with it, so reload from the fresh URL — the SPA's own
		// first-paint splash is the loading surface (or the error page if
		// it still fails).
		if (process.env.HOARDODILE_WEB_URL === undefined) {
			try {
				await win.loadURL(handle.url)
			} catch {
				await loadShellPage(
					win,
					shellPageTarget(runtime),
					serverErrorMessage(runtime.language),
				)
			}
		}
	}
}

function rebuildSidecarTray(runtime: Runtime): void {
	if (runtime.tray === undefined) return
	rebuildTrayMenu(
		runtime.tray,
		trayHandlers(runtime),
		{
			crashed: runtime.crashed,
			updateReady: runtime.updateReady,
		},
		trayStrings(runtime.language),
	)
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
	const win = runtime.window
	if (win !== undefined) {
		flushWindowState(runtime, win)
		win.destroy()
	}
	runtime.window = undefined
	try {
		runtime.sidecar = await spawnSidecar(runtime)
		runtime.crashed = false
		if (runtime.tray !== undefined) {
			rebuildTrayMenu(
				runtime.tray,
				trayHandlers(runtime),
				{
					crashed: false,
					updateReady: runtime.updateReady,
				},
				trayStrings(runtime.language),
			)
		}
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		dialog.showErrorBox(
			"hoardodile",
			shellCatalogFor(
				runtime.language,
			).desktopShell.dialog.serverFailedToStart.replace(
				"{{message}}",
				() => message,
			),
		)
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
	const win = runtime.window
	if (win !== undefined) {
		flushWindowState(runtime, win)
		win.destroy()
	}
	runtime.window = undefined
	if (runtime.tray !== undefined) {
		rebuildTrayMenu(
			runtime.tray,
			trayHandlers(runtime),
			{
				crashed: true,
				updateReady: runtime.updateReady,
			},
			trayStrings(runtime.language),
		)
	}
	new Notification({
		title: "hoardodile",
		body: shellCatalogFor(runtime.language).desktopShell.dialog
			.serverStoppedBody,
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
		const catalog = shellCatalogFor(runtime.language)
		const { response } = await dialog.showMessageBox({
			type: "warning",
			title: "hoardodile",
			message: catalog.desktopShell.dialog.serverNotRunningMessage,
			buttons: [
				catalog.desktopShell.dialog.restartServer,
				catalog.desktopShell.dialog.cancel,
			],
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
		language: runtime.language,
		initialBounds: runtime.config.windowBounds,
		maximized: runtime.config.windowMaximized,
	})
	bindWindowMaximizeEvents(win)
	// Window geometry persistence: the tray-hide/relaunch paths destroy
	// the window, so the normal bounds + maximized flag ride desktop.json.
	win.on("resize", () => scheduleWindowStatePersist(runtime, win))
	win.on("move", () => scheduleWindowStatePersist(runtime, win))
	win.on("close", () => flushWindowState(runtime, win))
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
			devServerErrorMessage(runtime.language),
		)
		return
	}
	// The SPA's first-paint splash is the loading surface (same dimmed
	// logo), so the window loads the app directly and the boot stays in a
	// single document — no shell-page handoff, no flash between surfaces.
	await win.loadURL(url)
}

/** Localized close-confirm copy for the native dialog; the SPA pushes the language via the bridge. */
function closeDialogStrings(language: SupportedLanguage | undefined) {
	const ui = shellCatalogFor(language)
	return {
		title: ui.closeConfirm.title,
		description: ui.closeConfirm.description,
		tray: ui.closeConfirm.tray,
		quit: ui.closeConfirm.quit,
		cancel: ui.closeConfirm.cancel,
		remember: ui.closeConfirm.remember,
	}
}

/** Localized tray copy — same language source as the close dialog. */
function trayStrings(language: SupportedLanguage | undefined) {
	const catalog = shellCatalogFor(language)
	return {
		open: catalog.desktopShell.tray.open,
		changeLibrary: catalog.desktopShell.tray.changeLibrary,
		restartServer: catalog.desktopShell.tray.restartServer,
		updateReady: catalog.desktopShell.tray.updateReady,
		updateReadyResources: catalog.desktopShell.tray.updateReadyResources,
		quit: catalog.desktopShell.tray.quit,
		tooltipServerStopped: catalog.desktopShell.tray.tooltipServerStopped,
		tooltipUpdateReady: catalog.desktopShell.tray.tooltipUpdateReady,
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
	// Closing the window drops the session: reopening (tray, second
	// launch) always lands on the sign-in screen. Quit is re-covered at
	// boot by requireSignInOnLaunch; internal destroys (sidecar crash,
	// LAN failure) never pass through here and keep the session.
	if (runtime.config.requireSignInOnWindowOpen) {
		await clearSessionCookies(session.defaultSession)
	}
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
 * The error page's Retry button: re-resolve the app URL (Vite in dev, the
 * sidecar otherwise) and reload; on failure the window's own
 * `did-fail-load` guard swaps in a fresh error page. The SPA's first-paint
 * splash is the loading surface while the reload settles.
 */
async function retryAppWindow(runtime: Runtime): Promise<void> {
	const win = runtime.window
	if (win === undefined || win.isDestroyed()) {
		await openAppWindow(runtime)
		return
	}
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
			serverErrorMessage(runtime.language),
		)
		return
	}
	if (url === undefined) {
		await loadShellPage(
			win,
			shellPageTarget(runtime),
			devServerErrorMessage(runtime.language),
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
			// `target.url` is "" on packaged runs so loadWindow falls
			// through to the built wizard file — never substitute
			// "about:blank" here, that URL is non-empty and would keep
			// the wizard permanently blank.
			url: target.url,
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
		// Seed from the OS locale so tray/menus/native dialogs are localized
		// before the SPA pushes its persisted language choice.
		language: resolveSystemLanguage(app.getLocale()),
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
		async openLogsFolder() {
			// The sidecar's STORAGE_ROOT is the library folder, so the
			// server logs live at `<library>/local/logs`. Ensure the folder
			// exists (a fresh install has no log yet), then hand it to the
			// OS file manager; `shell.openPath` resolves "" on success.
			const logsDir = join(runtime.config.libraryPath, "local", "logs")
			try {
				mkdirSync(logsDir, { recursive: true })
				return (await shell.openPath(logsDir)) === ""
			} catch (err) {
				console.error(
					`[desktop] failed to open logs folder: ${
						err instanceof Error ? err.message : String(err)
					}`,
				)
				return false
			}
		},
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
			// Same close-time sign-out rule as the window close guard:
			// the renderer decided to close; the session dies with it.
			if (runtime.config.requireSignInOnWindowOpen) {
				await clearSessionCookies(session.defaultSession)
			}
			if (action === "quit") {
				await quitApp(runtime)
				return
			}
			// Hide to tray: destroy is intentional — it skips the close
			// guard (the renderer already decided) and the app keeps
			// running under the tray with the session intact. Flush the
			// last geometry first: destroy() never emits `close`.
			const win = runtime.window
			if (win !== undefined) {
				flushWindowState(runtime, win)
				win.destroy()
			}
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
		checkLanEnabled: () => checkLanEnabled(runtime),
		setLanEnabled: (enabled, options) =>
			setLanEnabled(runtime, enabled, options?.weakPasswordConfirmed === true),
		setLanPort: (port) => setLanPort(runtime, port),
		shellCacheSize: () =>
			getShellCacheSize({
				session: session.defaultSession,
				updaterCacheDir: updaterCacheDir(),
				canClearUpdaterCache: true,
			}),
		shellCacheClear: () =>
			clearShellCache({
				session: session.defaultSession,
				updaterCacheDir: updaterCacheDir(),
				canClearUpdaterCache: updaterCacheClearable(runtime),
			}),
		completeWizard(result) {
			runtime.completeWizard?.(result)
		},
		defaultLibraryPath: () => runtime.defaultLibraryPath,
		updateStatus: () => runtime.updater?.status() ?? { status: "idle" },
		checkUpdates: () => runtime.updater?.check(true) ?? Promise.resolve(),
		applyUpdate: () => runtime.updater?.apply() ?? Promise.resolve(),
		async quitAndInstall() {
			runtime.quitting = true
			await runtime.sidecar?.stop()
			runtime.updater?.quitAndInstall()
		},
		openExternal: (url) => {
			// Validation happened in the IPC handler; the shell never opens
			// anything but http(s) from the renderer.
			void shell.openExternal(url)
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

	// Per-launch sign-in: drop the session cookie before the window loads
	// so the SPA always boots to the sign-in screen. Runs once per app
	// start (hidden tray launches included); reopening the window or
	// reloading after a LAN/port/resource change keeps the session.
	if (runtime.config.requireSignInOnLaunch) {
		await clearSessionCookies(session.defaultSession)
	}

	// Resource-swap crash recovery + shipped-tree reconciliation. Must
	// run before the sidecar spawns: recoverAtBoot may re-roll the tree.
	if (app.isPackaged) {
		const recovered = recoverAtBoot(process.resourcesPath)
		if (recovered !== "none") {
			console.log(`[desktop] resource swap recovered at boot: ${recovered}`)
		}
		const marker = readResourcesMarker(process.resourcesPath)
		if (
			marker !== undefined &&
			marker.version !== runtime.config.resourceVersion
		) {
			// A full installer replaced the tree (or a rollback restored an
			// older one): the marker wins.
			runtime.config = { ...runtime.config, resourceVersion: marker.version }
			persist(runtime)
		}
	}

	try {
		runtime.sidecar = await spawnSidecar(runtime)
	} catch (err) {
		const message = err instanceof Error ? err.message : String(err)
		dialog.showErrorBox(
			"hoardodile",
			shellCatalogFor(
				runtime.language,
			).desktopShell.dialog.serverFailedToStart.replace(
				"{{message}}",
				() => message,
			),
		)
		runtime.crashed = true
	}

	// Test-only hooks for the Playwright e2e suite (apps/desktop/e2e):
	// headless Linux CI has no StatusNotifier/DBus service behind the
	// tray, and the updater must never poll in a test. Both are optional
	// at runtime — every consumer guards with `?.` / `!== undefined`.
	// HOARDODILE_RESOURCE_FEED_BASE keeps the updater (and only the
	// updater) alive against a fixture feed: the tray is skipped in that
	// mode too (it cannot exist headless), but the resource channel runs
	// the real check→apply path.
	const extrasDisabled = isShellExtrasDisabled()
	const trayDisabled =
		extrasDisabled || process.env.HOARDODILE_RESOURCE_FEED_BASE !== undefined
	if (!trayDisabled) {
		runtime.tray = createAppTray(
			trayIconPath(
				app.isPackaged ? process.resourcesPath : runtime.desktopRoot,
			),
			trayHandlers(runtime),
			{
				crashed: runtime.crashed,
				updateReady: runtime.updateReady,
			},
			trayStrings(runtime.language),
		)
	}
	if (!extrasDisabled) {
		// Channels emit through `forward`, which is rebound to the
		// manager's notify once it exists (creation is synchronous, so
		// no emission can be lost).
		let forward: (state: DesktopUpdateState) => void = () => {}
		const full = startFullUpdater({
			portable: runtime.portable,
			dev: !app.isPackaged,
			onState: (state) => forward(state),
		})
		const support = resourceUpdateSupport({
			packaged: app.isPackaged,
			portable: runtime.portable,
			platform: process.platform,
			resourcesRoot: process.resourcesPath,
		})
		const resource = support.available
			? startResourceChannel({
					enabled: runtime.config.autoUpdate && !runtime.portable,
					dev: !app.isPackaged,
					support,
					resourcesRoot: process.resourcesPath,
					cacheDir: updaterCacheDir(),
					appVersion: app.getVersion(),
					electronVersion: process.versions.electron,
					platform: process.platform,
					arch: process.arch,
					getResourceVersion: () => runtime.config.resourceVersion,
					setResourceVersion: (version) => {
						runtime.config = {
							...runtime.config,
							resourceVersion: version,
						}
						persist(runtime)
					},
					stopSidecar: async () => {
						await runtime.sidecar?.stop()
					},
					startSidecar: async () => {
						runtime.sidecar = await spawnSidecar(runtime)
					},
					watchSidecarCrash: (listener) => {
						const handle = runtime.sidecar
						return handle === undefined ? () => {} : handle.onCrash(listener)
					},
					reloadWindow: async () => {
						const win = runtime.window
						if (win !== undefined && !win.isDestroyed()) {
							// The restarted sidecar may have landed on a
							// different port (its predecessor's sockets can
							// linger between stop and rebind, e.g. TIME_WAIT
							// on Windows); a bare `reload()` would retry the
							// stale URL and park the window on the shell
							// error page. Follow the sidecar's actual
							// endpoint instead — the session cookie is
							// host-scoped (127.0.0.1), so a port change keeps
							// the user signed in. A failed load falls through
							// to the in-window error page + Retry.
							const url = runtime.sidecar?.url
							if (url !== undefined && win.webContents.getURL() !== url) {
								await win.loadURL(url).catch(() => undefined)
								return
							}
							win.webContents.reload()
							return
						}
						await openAppWindow(runtime)
					},
					emit: (state) => forward(state),
				})
			: undefined
		runtime.updater = startUpdateManager({
			enabled: runtime.config.autoUpdate && !runtime.portable,
			dev: !app.isPackaged,
			full,
			resource,
			onState(state) {
				runtime.updateReady = state.status === "ready"
				broadcastUpdate(runtime, state)
			},
		})
		forward = (state) => {
			runtime.updater?.notify(state)
		}
	}

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

/**
 * Test-only switch for the Playwright e2e suite (apps/desktop/e2e): skip
 * tray + updater so a headless CI run neither needs a StatusNotifier/DBus
 * service nor polls the update feed. Every consumer already tolerates a
 * missing tray/updater (`undefined` guards).
 */
function isShellExtrasDisabled(): boolean {
	return process.env.HOARDODILE_E2E === "1"
}

/**
 * Test-only: `--user-data-dir=<dir>` (VS Code / Chromium convention)
 * points the whole app — config, session cookies, caches — at a
 * throwaway profile, so e2e runs are hermetic. Must run before
 * `requestSingleInstanceLock` and `whenReady`. `HOARDODILE_E2E_DOCUMENTS`
 * additionally pins the wizard's default library folder (Documents).
 */
function applyUserDataDirArg(): void {
	const prefix = "--user-data-dir="
	const arg = process.argv.find((entry) => entry.startsWith(prefix))
	if (arg === undefined) return
	const dir = arg.slice(prefix.length)
	if (dir.length === 0) return
	app.setPath("userData", dir)
	const documents = process.env.HOARDODILE_E2E_DOCUMENTS
	if (documents !== undefined && documents.length > 0) {
		app.setPath("documents", documents)
	}
}

applyUserDataDirArg()

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
		void applyDesktopProxy()
		void boot()
	})
}
