import { render, screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { HoardodileDesktopBridge } from "@/lib/desktop"
import { ShellCachePanel } from "./ShellCachePanel"

function installBridge(
	overrides?: Partial<HoardodileDesktopBridge>,
): HoardodileDesktopBridge {
	const bridge: HoardodileDesktopBridge = {
		isDesktop: true,
		platform: "desktop",
		minimize() {},
		toggleMaximize() {},
		close() {},
		retryLoad() {},
		async isMaximized() {
			return false
		},
		onMaximizedChange() {
			return () => undefined
		},
		updates: {
			portable: false,
			async status() {
				return { status: "idle" }
			},
			onStatus() {
				return () => undefined
			},
			async check() {},
			async apply() {},
			async quitAndInstall() {},
		},
		async pickLibraryFolder() {
			return undefined
		},
		async relaunch() {},
		async getConfig() {
			return {
				libraryPath: "",
				sharedFolderRoot: "",
				sharedFolderEnabled: false,
				port: 3000,
				lanEnabled: false,
				autoStart: false,
				startInTray: false,
				closeAction: "ask",
				requireSignInOnLaunch: true,
				requireSignInOnWindowOpen: true,
				autoUpdate: false,
				portable: false,
				resourceVersion: null,
			}
		},
		async setConfig() {},
		async setCloseAction() {},
		async closeWithAction() {},
		setLanguage() {},
		async getLanguage() {
			return "en"
		},
		async changeLibraryFolder() {},
		async setSharedFolderRoot() {},
		async setSharedFolderEnabled() {},
		async getLanInfo() {
			return {
				enabled: false,
				port: 3000,
				preferredPort: 3000,
				addresses: [],
			}
		},
		async checkLanEnabled() {
			return { ok: true }
		},
		async setLanEnabled() {
			return { ok: true }
		},
		async setLanPort() {},
		async getShellCacheSize() {
			return 1024
		},
		async clearShellCache() {
			return 1024
		},
		async completeWizard() {},
		async getWizardDefaults() {
			return { libraryPath: "" }
		},
		openExternal() {},
		registerAppRoutes() {},
		...overrides,
	}
	window.hoardodileDesktop = bridge
	return bridge
}

afterEach(() => {
	Reflect.deleteProperty(window, "hoardodileDesktop")
})

describe("ShellCachePanel", () => {
	it("renders nothing in a normal browser tab", () => {
		const { container } = render(<ShellCachePanel />)
		expect(container).toBeEmptyDOMElement()
	})

	it("shows the current shell cache size", async () => {
		const size = vi.fn().mockResolvedValue(8 * 1024 * 1024)
		installBridge({ getShellCacheSize: size })
		render(<ShellCachePanel />)
		const badge = await screen.findByTestId("desktop-shell-cache-size")
		await waitFor(() => {
			expect(badge.textContent).toContain("8 MB")
		})
		expect(size).toHaveBeenCalled()
	})

	it("clears the shell cache after confirmation and refreshes the size", async () => {
		const user = userEvent.setup()
		let reads = 0
		const size = vi.fn().mockImplementation(async () => {
			reads += 1
			return reads === 1 ? 8 * 1024 * 1024 : 0
		})
		const clear = vi.fn().mockResolvedValue(8 * 1024 * 1024)
		installBridge({ getShellCacheSize: size, clearShellCache: clear })
		render(<ShellCachePanel />)
		await screen.findByTestId("desktop-shell-cache-size")

		await user.click(await screen.findByTestId("desktop-shell-cache-clear"))
		const dialog = await screen.findByRole("dialog")
		await user.click(
			within(dialog).getByRole("button", { name: "Clear cache" }),
		)

		await waitFor(() => {
			expect(clear).toHaveBeenCalledTimes(1)
		})
		await waitFor(() => {
			expect(size.mock.calls.length).toBeGreaterThan(1)
		})
	})

	it("shows unavailable when the size read fails", async () => {
		installBridge({
			getShellCacheSize: vi.fn().mockRejectedValue(new Error("boom")),
		})
		render(<ShellCachePanel />)
		const badge = await screen.findByTestId("desktop-shell-cache-size")
		await waitFor(() => {
			expect(badge.textContent).toContain("Unavailable")
		})
	})
})
