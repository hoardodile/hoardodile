import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import { autoUpdater } from "electron-updater"

export type UpdaterHandle = {
	status: () => DesktopUpdateState
	onStatus: (listener: (state: DesktopUpdateState) => void) => () => void
	check: () => Promise<void>
	quitAndInstall: () => void
	setEnabled: (enabled: boolean) => void
	dispose: () => void
}

const BOOT_DELAY_MS = 15_000
const INTERVAL_MS = 24 * 60 * 60 * 1000

export function startUpdater(options: {
	readonly enabled: boolean
	readonly portable: boolean
	readonly onReady: () => void
}): UpdaterHandle {
	let state: DesktopUpdateState = { status: "idle" }
	const listeners = new Set<(state: DesktopUpdateState) => void>()

	function emit(next: DesktopUpdateState): void {
		state = next
		for (const listener of listeners) listener(state)
	}

	function subscribe(listener: (next: DesktopUpdateState) => void): () => void {
		listeners.add(listener)
		return () => {
			listeners.delete(listener)
		}
	}

	if (options.portable) {
		return {
			status: () => state,
			onStatus: subscribe,
			async check() {
				emit({ status: "idle" })
			},
			quitAndInstall() {
				// portable: GitHub zip only
			},
			setEnabled() {
				// portable never auto-updates
			},
			dispose() {
				listeners.clear()
			},
		}
	}

	autoUpdater.autoInstallOnAppQuit = false
	autoUpdater.autoRunAppAfterInstall = true
	autoUpdater.autoDownload = options.enabled

	autoUpdater.on("checking-for-update", () => {
		emit({ status: "checking" })
	})
	autoUpdater.on("update-available", () => {
		emit({ status: "downloading", percent: 0 })
	})
	autoUpdater.on("update-not-available", () => {
		emit({ status: "latest" })
	})
	autoUpdater.on("download-progress", (progress) => {
		emit({
			status: "downloading",
			percent: progress.percent,
		})
	})
	autoUpdater.on("update-downloaded", (info) => {
		emit({ status: "ready", version: info.version })
		options.onReady()
	})
	autoUpdater.on("error", (err) => {
		emit({ status: "error", message: err.message })
	})

	const timers: NodeJS.Timeout[] = []

	function clearTimers(): void {
		for (const timer of timers) clearTimeout(timer)
		timers.length = 0
	}

	function scheduleBackgroundChecks(): void {
		clearTimers()
		timers.push(
			setTimeout(() => {
				void autoUpdater.checkForUpdates().catch(() => undefined)
			}, BOOT_DELAY_MS),
		)
		timers.push(
			setInterval(() => {
				void autoUpdater.checkForUpdates().catch(() => undefined)
			}, INTERVAL_MS),
		)
	}

	if (options.enabled) scheduleBackgroundChecks()

	return {
		status: () => state,
		onStatus: subscribe,
		async check() {
			const previous = autoUpdater.autoDownload
			autoUpdater.autoDownload = true
			try {
				await autoUpdater.checkForUpdates()
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				emit({ status: "error", message })
			} finally {
				autoUpdater.autoDownload = previous
			}
		},
		quitAndInstall() {
			autoUpdater.quitAndInstall(false, true)
		},
		setEnabled(enabled) {
			autoUpdater.autoDownload = enabled
			if (enabled) scheduleBackgroundChecks()
			else clearTimers()
		},
		dispose() {
			clearTimers()
			autoUpdater.removeAllListeners()
			listeners.clear()
		},
	}
}
