import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { HoardodileDesktopBridge } from "@/lib/desktop"
import { DesktopLibrarySection } from "./DesktopLibrarySection"

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
		async openLogsFolder() {
			return true
		},
		async getConfig() {
			return {
				libraryPath: "C:/lib",
				sharedFolderRoot: "C:/docs",
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
				https: false,
				port: 3000,
				preferredPort: 3000,
				lanPort: 3000,
				lanPreferredPort: 3000,
				lanHttpsPort: 3001,
				lanHttpsPreferredPort: 3001,
				fingerprint: undefined,
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
		async setLanHttps() {},
		async getShellCacheSize() {
			return 0
		},
		async clearShellCache() {
			return 0
		},
		async completeWizard() {},
		async getWizardDefaults() {
			return { libraryPath: "C:/lib" }
		},
		openExternal() {},
		registerAppRoutes() {},
		...overrides,
	}
	window.hoardodileDesktop = bridge
	return bridge
}

function renderSection() {
	const queryClient = new QueryClient()
	return render(
		<QueryClientProvider client={queryClient}>
			<DesktopLibrarySection />
		</QueryClientProvider>,
	)
}

afterEach(() => {
	Reflect.deleteProperty(window, "hoardodileDesktop")
})

describe("DesktopLibrarySection", () => {
	it("shows the per-launch sign-in toggle checked by default", async () => {
		installBridge()
		renderSection()
		const toggle = await screen.findByTestId("desktop-sign-in-on-launch")
		await waitFor(() => {
			expect(toggle).toBeChecked()
		})
	})

	it("persists the per-launch sign-in toggle through the bridge", async () => {
		const setConfig = vi.fn(async () => {})
		installBridge({ setConfig })
		renderSection()
		const toggle = await screen.findByTestId("desktop-sign-in-on-launch")
		fireEvent.click(toggle)
		await waitFor(() => {
			expect(setConfig).toHaveBeenCalledWith({ requireSignInOnLaunch: false })
		})
	})

	it("shows the tray-reopen sign-in toggle checked by default", async () => {
		installBridge()
		renderSection()
		const toggle = await screen.findByTestId("desktop-sign-in-on-window-open")
		await waitFor(() => {
			expect(toggle).toBeChecked()
		})
	})

	it("persists the tray-reopen sign-in toggle through the bridge", async () => {
		const setConfig = vi.fn(async () => {})
		installBridge({ setConfig })
		renderSection()
		const toggle = await screen.findByTestId("desktop-sign-in-on-window-open")
		fireEvent.click(toggle)
		await waitFor(() => {
			expect(setConfig).toHaveBeenCalledWith({
				requireSignInOnWindowOpen: false,
			})
		})
	})
})
