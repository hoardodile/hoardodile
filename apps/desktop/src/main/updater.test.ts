/**
 * @vitest-environment node
 *
 * The full-update channel is a thin wrapper around electron-updater; the
 * only logic worth pinning is the state mapping, the enablement gate and
 * the no-op portable shape. electron-updater is mocked, so the event
 * handlers registered via `autoUpdater.on` are invoked directly.
 */

import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import { autoUpdater } from "electron-updater"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { startFullUpdater } from "./updater.ts"

vi.mock("electron-updater", () => ({
	autoUpdater: {
		autoInstallOnAppQuit: false,
		autoRunAppAfterInstall: false,
		autoDownload: false,
		on: vi.fn(),
		checkForUpdates: vi.fn(),
		quitAndInstall: vi.fn(),
		removeAllListeners: vi.fn(),
	},
}))

type EventHandler = (payload?: unknown) => void

function eventMap(): Record<string, EventHandler> {
	return Object.fromEntries(
		(vi.mocked(autoUpdater.on).mock.calls as [string, EventHandler][]).map(
			([event, handler]) => [event, handler],
		),
	)
}

describe("full updater", () => {
	beforeEach(() => {
		vi.clearAllMocks()
		autoUpdater.autoInstallOnAppQuit = false
		autoUpdater.autoRunAppAfterInstall = false
		autoUpdater.autoDownload = false
	})

	it("is a silent install-on-quit updater", () => {
		startFullUpdater({ portable: false, dev: false, onState: () => undefined })
		expect(autoUpdater.autoInstallOnAppQuit).toBe(true)
		expect(autoUpdater.autoRunAppAfterInstall).toBe(true)
		expect(autoUpdater.autoDownload).toBe(true)
	})

	it("maps the updater events onto the shared state machine", async () => {
		const emitted: DesktopUpdateState[] = []
		startFullUpdater({
			portable: false,
			dev: false,
			onState: (s) => emitted.push(s),
		})
		const events = eventMap()

		events["checking-for-update"]?.()
		events["update-available"]?.()
		events["download-progress"]?.({ percent: 50 })
		events["update-downloaded"]?.({ version: "1.2.3" })
		expect(emitted).toEqual([
			{ status: "checking", channel: "full" },
			{ status: "downloading", channel: "full", percent: 0 },
			{ status: "downloading", channel: "full", percent: 50 },
			{ status: "ready", channel: "full", version: "1.2.3" },
		])

		emitted.length = 0
		events["update-not-available"]?.()
		expect(emitted).toEqual([{ status: "latest" }])

		emitted.length = 0
		events.error?.({ message: "boom" })
		expect(emitted).toEqual([{ status: "error", message: "boom" }])
	})

	it("checks for updates and restores the previous autoDownload", async () => {
		const full = startFullUpdater({
			portable: false,
			dev: false,
			onState: () => undefined,
		})
		full.setEnabled(false)
		vi.mocked(autoUpdater.checkForUpdates).mockResolvedValue(null)
		await full.check()
		expect(autoUpdater.checkForUpdates).toHaveBeenCalledTimes(1)
		// The forced-download check restored the user's disabled state.
		expect(autoUpdater.autoDownload).toBe(false)
	})

	it("reports an error when checkForUpdates throws", async () => {
		const emitted: DesktopUpdateState[] = []
		const full = startFullUpdater({
			portable: false,
			dev: false,
			onState: (s) => emitted.push(s),
		})
		vi.mocked(autoUpdater.checkForUpdates).mockRejectedValue(new Error("net"))
		await full.check()
		expect(emitted).toEqual([{ status: "error", message: "net" }])
	})

	it("never checks in dev runs", async () => {
		const full = startFullUpdater({
			portable: false,
			dev: true,
			onState: () => undefined,
		})
		await full.check()
		expect(autoUpdater.checkForUpdates).not.toHaveBeenCalled()
	})

	it("setEnabled toggles autoDownload", () => {
		const full = startFullUpdater({
			portable: false,
			dev: false,
			onState: () => undefined,
		})
		full.setEnabled(false)
		expect(autoUpdater.autoDownload).toBe(false)
		full.setEnabled(true)
		expect(autoUpdater.autoDownload).toBe(true)
	})

	it("delegates quitAndInstall and dispose", () => {
		const full = startFullUpdater({
			portable: false,
			dev: false,
			onState: () => undefined,
		})
		full.quitAndInstall()
		expect(autoUpdater.quitAndInstall).toHaveBeenCalledTimes(1)
		full.dispose()
		expect(autoUpdater.removeAllListeners).toHaveBeenCalledTimes(1)
	})

	it("is a no-op updater in portable mode", async () => {
		const emitted: DesktopUpdateState[] = []
		const full = startFullUpdater({
			portable: true,
			dev: false,
			onState: (s) => emitted.push(s),
		})
		await full.check()
		expect(emitted).toEqual([{ status: "latest" }])
		full.quitAndInstall()
		full.setEnabled(true)
		expect(autoUpdater.quitAndInstall).not.toHaveBeenCalled()
		expect(autoUpdater.on).not.toHaveBeenCalled()
	})
})
