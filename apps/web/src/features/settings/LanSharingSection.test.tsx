import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { HoardodileDesktopBridge } from "@/lib/desktop"
import { LanSharingSection } from "./LanSharingSection"

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
				lanEnabled: true,
				autoStart: false,
				startInTray: false,
				closeAction: "ask",
				autoUpdate: false,
				portable: false,
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
				enabled: true,
				port: 3000,
				preferredPort: 3000,
				addresses: [{ interfaceName: "Ethernet", address: "192.168.1.20" }],
			}
		},
		async setLanEnabled() {},
		async setLanPort() {},
		async completeWizard() {},
		async getWizardDefaults() {
			return { libraryPath: "" }
		},
		...overrides,
	}
	window.hoardodileDesktop = bridge
	return bridge
}

afterEach(() => {
	Reflect.deleteProperty(window, "hoardodileDesktop")
})

describe("LanSharingSection", () => {
	it("shows one primary address with a QR code when sharing is on", async () => {
		installBridge()
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-section")
		await waitFor(() => {
			expect(screen.getByTestId("desktop-lan-primary-url")).toHaveTextContent(
				"http://192.168.1.20:3000/",
			)
		})
		expect(screen.getByTestId("desktop-lan-copy-primary")).toBeInTheDocument()
		expect(screen.queryByTestId("desktop-lan-more-addresses")).toBeNull()
		expect(document.querySelector("svg")).not.toBeNull()
	})

	it("hides the address area while sharing is off", async () => {
		installBridge({
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
					autoUpdate: false,
					portable: false,
				}
			},
			async getLanInfo() {
				return {
					enabled: false,
					port: 3000,
					preferredPort: 3000,
					addresses: [],
				}
			},
		})
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-section")
		expect(screen.queryByTestId("desktop-lan-primary-url")).toBeNull()
	})

	it("folds virtual-adapter addresses into an expandable list", async () => {
		installBridge({
			async getLanInfo() {
				return {
					enabled: true,
					port: 3000,
					preferredPort: 3000,
					addresses: [
						{ interfaceName: "Ethernet", address: "192.168.3.60" },
						{
							interfaceName: "vEthernet (WSL (Hyper-V firewall))",
							address: "172.17.112.1",
						},
						{ interfaceName: "Meta", address: "198.18.0.1" },
					],
				}
			},
		})
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-primary-url")
		expect(screen.getByTestId("desktop-lan-primary-url")).toHaveTextContent(
			"http://192.168.3.60:3000/",
		)
		const summary = screen.getByTestId("desktop-lan-more-addresses")
		fireEvent.click(summary)
		await waitFor(() => {
			expect(
				screen.getByTestId("desktop-lan-copy-172.17.112.1"),
			).toBeInTheDocument()
		})
		expect(
			screen.getByTestId("desktop-lan-copy-198.18.0.1"),
		).toBeInTheDocument()
	})

	it("shows an empty hint when no address is reachable", async () => {
		installBridge({
			async getLanInfo() {
				return {
					enabled: true,
					port: 3000,
					preferredPort: 3000,
					addresses: [],
				}
			},
		})
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-no-addresses")
	})

	it("shows a prominent notice when the listening port differs from the preferred port", async () => {
		installBridge({
			async getLanInfo() {
				return {
					enabled: true,
					port: 4040,
					preferredPort: 3000,
					addresses: [{ interfaceName: "Ethernet", address: "192.168.1.20" }],
				}
			},
		})
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-port-adjusted")
		expect(screen.getByTestId("desktop-lan-port-adjusted")).toHaveTextContent(
			/4040/,
		)
		expect(screen.getByTestId("desktop-lan-port-apply")).toBeDisabled()
	})

	it("applies a new port via the bridge", async () => {
		const setLanPort = vi.fn(async () => {})
		installBridge({ setLanPort })
		render(<LanSharingSection />)
		const input = await screen.findByTestId("desktop-lan-port-input")
		fireEvent.change(input, { target: { value: "4040" } })
		fireEvent.click(screen.getByTestId("desktop-lan-port-apply"))
		await waitFor(() => {
			expect(setLanPort).toHaveBeenCalledWith(4040)
		})
	})

	it("toggles sharing through the bridge", async () => {
		const setLanEnabled = vi.fn(async () => {})
		installBridge({ setLanEnabled })
		render(<LanSharingSection />)
		const toggle = await screen.findByTestId("desktop-lan-enable")
		fireEvent.click(toggle)
		await waitFor(() => {
			expect(setLanEnabled).toHaveBeenCalledWith(false)
		})
	})

	it("renders nothing without the desktop bridge", () => {
		const { container } = render(<LanSharingSection />)
		expect(container).toBeEmptyDOMElement()
	})
})
