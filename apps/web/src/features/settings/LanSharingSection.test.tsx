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
				autoUpdate: false,
				portable: false,
			}
		},
		async setConfig() {},
		async changeLibraryFolder() {},
		async setSharedFolderRoot() {},
		async setSharedFolderEnabled() {},
		async getLanInfo() {
			return {
				enabled: true,
				port: 3000,
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
	it("renders the port row and the address list with a QR code when sharing is on", async () => {
		installBridge()
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-section")
		await waitFor(() => {
			expect(screen.getByText("192.168.1.20")).toBeInTheDocument()
		})
		expect(screen.getByTestId("desktop-lan-qr-hint")).toBeInTheDocument()
		expect(
			screen.getByTestId("desktop-lan-copy-http://192.168.1.20:3000/"),
		).toBeInTheDocument()
		expect(document.querySelector("svg")).not.toBeNull()
	})

	it("hides the address list while sharing is off", async () => {
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
					autoUpdate: false,
					portable: false,
				}
			},
			async getLanInfo() {
				return { enabled: false, port: 3000, addresses: [] }
			},
		})
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-section")
		expect(screen.queryByText("192.168.1.20")).toBeNull()
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
