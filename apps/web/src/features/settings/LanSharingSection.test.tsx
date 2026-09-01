import type {
	LanAddress,
	LanCheckResult,
	LanInfo,
	LanSetResult,
} from "@hoardodile/shared/desktop"
import { toast } from "@hoardodile/ui/components/toast"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, it, vi } from "vitest"
import type { HoardodileDesktopBridge } from "@/lib/desktop"
import { LanSharingSection } from "./LanSharingSection"

vi.mock("@hoardodile/ui/components/toast", () => ({
	toast: { add: vi.fn() },
}))

function lanInfo(
	options: {
		readonly enabled?: boolean
		readonly https?: boolean
		readonly port?: number
		readonly lanPort?: number
		readonly lanPreferredPort?: number
		readonly lanHttpsPort?: number
		readonly addresses?: readonly LanAddress[]
	} = {},
): LanInfo {
	const port = options.port ?? 3000
	return {
		enabled: options.enabled ?? true,
		https: options.https ?? false,
		port,
		preferredPort: port,
		lanPort: options.lanPort ?? port,
		lanPreferredPort: options.lanPreferredPort ?? port,
		lanHttpsPort: options.lanHttpsPort ?? port + 1,
		lanHttpsPreferredPort: options.lanHttpsPort ?? port + 1,
		fingerprint: undefined,
		addresses: options.addresses ?? [],
	}
}

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
				libraryPath: "",
				sharedFolderRoot: "",
				sharedFolderEnabled: false,
				port: 3000,
				lanEnabled: true,
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
			return lanInfo({
				addresses: [{ interfaceName: "Ethernet", address: "192.168.1.20" }],
			})
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
	vi.mocked(toast.add).mockClear()
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

	it("toggles the HTTPS scheme and updates the shown LAN URL", async () => {
		const setLanHttpsMock = vi.fn(async (_enabled: boolean) => {})
		let https = false
		installBridge({
			async setLanHttps(enabled) {
				setLanHttpsMock(enabled)
				https = enabled
			},
			async getLanInfo() {
				return lanInfo({
					https,
					addresses: [{ interfaceName: "Ethernet", address: "192.168.1.20" }],
				})
			},
		})
		render(<LanSharingSection />)
		const toggle = await screen.findByTestId("desktop-lan-https")
		expect(toggle).not.toBeChecked()
		await waitFor(() => {
			expect(screen.getByTestId("desktop-lan-primary-url")).toHaveTextContent(
				"http://192.168.1.20:3000/",
			)
		})
		fireEvent.click(toggle)
		await waitFor(() => {
			expect(setLanHttpsMock).toHaveBeenCalledWith(true)
		})
		await waitFor(() => {
			expect(screen.getByTestId("desktop-lan-primary-url")).toHaveTextContent(
				"https://192.168.1.20:3001/",
			)
		})
	})

	it("shows the localhost address with copy and open buttons while sharing is off", async () => {
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
					requireSignInOnLaunch: true,
					requireSignInOnWindowOpen: true,
					autoUpdate: false,
					portable: false,
					resourceVersion: null,
				}
			},
			async getLanInfo() {
				return lanInfo({ enabled: false })
			},
		})
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-section")
		expect(screen.getByTestId("desktop-lan-local-url")).toHaveTextContent(
			"http://127.0.0.1:3000/",
		)
		expect(screen.getByTestId("desktop-lan-copy-local")).toBeInTheDocument()
		expect(screen.getByTestId("desktop-lan-open-local")).toBeInTheDocument()
		expect(screen.queryByTestId("desktop-lan-primary-url")).toBeNull()
	})

	it("keeps the localhost address while sharing is on", async () => {
		installBridge()
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-primary-url")
		expect(screen.getByTestId("desktop-lan-local-url")).toHaveTextContent(
			"http://127.0.0.1:3000/",
		)
	})

	it("opens the localhost address in the OS browser", async () => {
		const openExternal = vi.fn()
		installBridge({ openExternal })
		render(<LanSharingSection />)
		const open = await screen.findByTestId("desktop-lan-open-local")
		fireEvent.click(open)
		await waitFor(() => {
			expect(openExternal).toHaveBeenCalledWith("http://127.0.0.1:3000/")
		})
	})

	it("uses the actual listening port in the localhost address after a fallback", async () => {
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
					requireSignInOnLaunch: true,
					requireSignInOnWindowOpen: true,
					autoUpdate: false,
					portable: false,
					resourceVersion: null,
				}
			},
			async getLanInfo() {
				return lanInfo({ enabled: false, port: 4040 })
			},
		})
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-local-url")
		expect(screen.getByTestId("desktop-lan-local-url")).toHaveTextContent(
			"http://127.0.0.1:4040/",
		)
	})

	it("folds virtual-adapter addresses into an expandable list", async () => {
		installBridge({
			async getLanInfo() {
				return lanInfo({
					addresses: [
						{ interfaceName: "Ethernet", address: "192.168.3.60" },
						{
							interfaceName: "vEthernet (WSL (Hyper-V firewall))",
							address: "172.17.112.1",
						},
						{ interfaceName: "Meta", address: "198.18.0.1" },
					],
				})
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
				return lanInfo()
			},
		})
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-no-addresses")
	})

	it("shows a prominent notice and lets the user reclaim the preferred port when the listening port differs", async () => {
		const setLanPort = vi.fn(async () => {})
		installBridge({
			setLanPort,
			async getLanInfo() {
				return lanInfo({
					port: 4040,
					addresses: [{ interfaceName: "Ethernet", address: "192.168.1.20" }],
					lanPort: 4040,
					lanPreferredPort: 3000,
				})
			},
		})
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-port-adjusted")
		expect(screen.getByTestId("desktop-lan-port-adjusted")).toHaveTextContent(
			/4040/,
		)
		// The input shows the preferred port (3000) but the actual port drifted
		// to 4040, so Apply is enabled — clicking it reclaims the preferred port
		// instead of being a silent no-op.
		const apply = screen.getByTestId("desktop-lan-port-apply")
		expect(apply).toBeEnabled()
		fireEvent.click(apply)
		await waitFor(() => {
			expect(setLanPort).toHaveBeenCalledWith(3000)
		})
	})

	it("hides the port-adjusted notice while sharing is off", async () => {
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
					requireSignInOnLaunch: true,
					requireSignInOnWindowOpen: true,
					autoUpdate: false,
					portable: false,
					resourceVersion: null,
				}
			},
			async getLanInfo() {
				return lanInfo({ enabled: false, port: 4040 })
			},
		})
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-section")
		expect(screen.queryByTestId("desktop-lan-port-adjusted")).toBeNull()
	})

	it("dismisses the port-adjusted notice for the same adjustment only", async () => {
		function adjustedBridge(port: number) {
			installBridge({
				async getLanInfo() {
					return lanInfo({
						port,
						lanPort: port,
						lanPreferredPort: 3000,
						addresses: [{ interfaceName: "Ethernet", address: "192.168.1.20" }],
					})
				},
			})
		}

		adjustedBridge(4040)
		const first = render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-port-adjusted")
		fireEvent.click(screen.getByTestId("desktop-lan-port-adjusted-dismiss"))
		await waitFor(() => {
			expect(screen.queryByTestId("desktop-lan-port-adjusted")).toBeNull()
		})
		first.unmount()

		// Reopening the section keeps the dismissal (it lives in
		// localStorage, not component state).
		adjustedBridge(4040)
		const second = render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-section")
		expect(screen.queryByTestId("desktop-lan-port-adjusted")).toBeNull()
		second.unmount()

		// A different fallback port is a new adjustment: notice returns.
		adjustedBridge(5000)
		render(<LanSharingSection />)
		await screen.findByTestId("desktop-lan-port-adjusted")
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
		const setLanEnabled = vi.fn(
			async (): Promise<LanSetResult> => ({ ok: true }),
		)
		installBridge({ setLanEnabled })
		render(<LanSharingSection />)
		const toggle = await screen.findByTestId("desktop-lan-enable")
		fireEvent.click(toggle)
		await waitFor(() => {
			expect(setLanEnabled).toHaveBeenCalledWith(false)
		})
	})

	it("asks in the UI dialog before enabling with a weak admin password", async () => {
		const checkLanEnabled = vi.fn(
			async (): Promise<LanCheckResult> => ({
				ok: false,
				reason: "weak-password-required",
			}),
		)
		const setLanEnabled = vi.fn(
			async (): Promise<LanSetResult> => ({ ok: true }),
		)
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
					requireSignInOnLaunch: true,
					requireSignInOnWindowOpen: true,
					autoUpdate: false,
					portable: false,
					resourceVersion: null,
				}
			},
			async getLanInfo() {
				return lanInfo({ enabled: false })
			},
			checkLanEnabled,
			setLanEnabled,
		})
		render(<LanSharingSection />)
		const toggle = await screen.findByTestId("desktop-lan-enable")
		fireEvent.click(toggle)
		// The probe declines with `weak-password-required`: the dialog
		// appears first and nothing was enabled yet (no loading flash).
		await screen.findByTestId("desktop-lan-weak-confirm")
		await waitFor(() => {
			expect(checkLanEnabled).toHaveBeenCalledTimes(1)
		})
		expect(setLanEnabled).not.toHaveBeenCalled()
		fireEvent.click(screen.getByTestId("desktop-lan-weak-confirm"))
		await waitFor(() => {
			expect(setLanEnabled).toHaveBeenCalledWith(true, {
				weakPasswordConfirmed: true,
			})
		})
		// The confirmation completed; the dialog closes.
		await waitFor(() => {
			expect(screen.queryByTestId("desktop-lan-weak-confirm")).toBeNull()
		})
	})

	it("does nothing when the weak-password confirmation is cancelled", async () => {
		const checkLanEnabled = vi.fn(
			async (): Promise<LanCheckResult> => ({
				ok: false,
				reason: "weak-password-required",
			}),
		)
		const setLanEnabled = vi.fn(
			async (): Promise<LanSetResult> => ({ ok: true }),
		)
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
					requireSignInOnLaunch: true,
					requireSignInOnWindowOpen: true,
					autoUpdate: false,
					portable: false,
					resourceVersion: null,
				}
			},
			async getLanInfo() {
				return lanInfo({ enabled: false })
			},
			checkLanEnabled,
			setLanEnabled,
		})
		render(<LanSharingSection />)
		const toggle = await screen.findByTestId("desktop-lan-enable")
		fireEvent.click(toggle)
		await screen.findByTestId("desktop-lan-weak-cancel")
		fireEvent.click(screen.getByTestId("desktop-lan-weak-cancel"))
		await waitFor(() => {
			expect(screen.queryByTestId("desktop-lan-weak-confirm")).toBeNull()
		})
		// Only the probe happened; nothing was enabled.
		expect(checkLanEnabled).toHaveBeenCalledTimes(1)
		expect(setLanEnabled).not.toHaveBeenCalled()
	})

	it("enables directly when the probe needs no confirmation", async () => {
		const checkLanEnabled = vi.fn(
			async (): Promise<LanCheckResult> => ({ ok: true }),
		)
		const setLanEnabled = vi.fn(
			async (): Promise<LanSetResult> => ({ ok: true }),
		)
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
					requireSignInOnLaunch: true,
					requireSignInOnWindowOpen: true,
					autoUpdate: false,
					portable: false,
					resourceVersion: null,
				}
			},
			async getLanInfo() {
				return lanInfo({ enabled: false })
			},
			checkLanEnabled,
			setLanEnabled,
		})
		render(<LanSharingSection />)
		const toggle = await screen.findByTestId("desktop-lan-enable")
		fireEvent.click(toggle)
		await waitFor(() => {
			expect(checkLanEnabled).toHaveBeenCalledTimes(1)
			expect(setLanEnabled).toHaveBeenCalledWith(true)
		})
	})

	it("shows the busy spinner while a sharing change restarts the sidecar", async () => {
		let resolveEnable: (() => void) | undefined
		const setLanEnabled = vi.fn(async (): Promise<LanSetResult> => {
			await new Promise<void>((resolve) => {
				resolveEnable = resolve
			})
			return { ok: true }
		})
		installBridge({ setLanEnabled })
		render(<LanSharingSection />)
		const toggle = await screen.findByTestId("desktop-lan-enable")
		fireEvent.click(toggle)
		const spinner = await screen.findByTestId("desktop-lan-busy")
		expect(spinner).toBeInTheDocument()
		resolveEnable?.()
		await waitFor(() => {
			expect(screen.queryByTestId("desktop-lan-busy")).toBeNull()
		})
	})

	it("renders nothing without the desktop bridge", () => {
		const { container } = render(<LanSharingSection />)
		expect(container).toBeEmptyDOMElement()
	})
})
