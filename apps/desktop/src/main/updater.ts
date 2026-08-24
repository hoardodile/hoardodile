import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import { autoUpdater } from "electron-updater"

/**
 * The full-update channel: electron-updater against GitHub Releases.
 * Owns no cadence and no shared state — the update manager drives check()
 * on its schedule and funnels every state emission (tagged `channel:
 * "full"`) through the manager's notify.
 */

export type FullUpdaterHandle = {
	readonly check: () => Promise<void>
	readonly quitAndInstall: () => void
	readonly setEnabled: (enabled: boolean) => void
	readonly dispose: () => void
}

export function startFullUpdater(options: {
	readonly portable: boolean
	readonly dev: boolean
	readonly onState: (state: DesktopUpdateState) => void
}): FullUpdaterHandle {
	const { portable, dev, onState } = options

	if (portable) {
		// portable: GitHub zip only, no quitAndInstall, never auto-updates.
		return {
			async check() {
				onState({ status: "latest" })
			},
			quitAndInstall() {},
			setEnabled() {},
			dispose() {},
		}
	}

	autoUpdater.autoInstallOnAppQuit = false
	autoUpdater.autoRunAppAfterInstall = true
	autoUpdater.autoDownload = true

	autoUpdater.on("checking-for-update", () => {
		onState({ status: "checking", channel: "full" })
	})
	autoUpdater.on("update-available", () => {
		onState({ status: "downloading", channel: "full", percent: 0 })
	})
	autoUpdater.on("update-not-available", () => {
		onState({ status: "latest" })
	})
	autoUpdater.on("download-progress", (progress) => {
		onState({
			status: "downloading",
			channel: "full",
			percent: progress.percent,
		})
	})
	autoUpdater.on("update-downloaded", (info) => {
		onState({ status: "ready", channel: "full", version: info.version })
	})
	autoUpdater.on("error", (err) => {
		onState({ status: "error", message: err.message })
	})

	return {
		async check() {
			// Unpackaged runs can never download updates; skip silently
			// (electron-updater would print the skip line on every boot).
			if (dev) return
			const previous = autoUpdater.autoDownload
			autoUpdater.autoDownload = true
			try {
				await autoUpdater.checkForUpdates()
			} catch (err) {
				const message = err instanceof Error ? err.message : String(err)
				onState({ status: "error", message })
			} finally {
				autoUpdater.autoDownload = previous
			}
		},
		quitAndInstall() {
			autoUpdater.quitAndInstall(false, true)
		},
		setEnabled(enabled) {
			autoUpdater.autoDownload = enabled
		},
		dispose() {
			autoUpdater.removeAllListeners()
		},
	}
}
