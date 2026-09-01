import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
	APP_DEVELOPER_URL,
	APP_ISSUES_BUG_DESKTOP_URL,
	APP_ISSUES_BUG_SELFHOSTED_URL,
	APP_ISSUES_FEATURE_URL,
	APP_REPOSITORY_URL,
	APP_VERSION,
	APP_WEBSITE_URL,
} from "@/lib/appInfo"
import { prefKeys } from "@/lib/keys"
import { AboutSection } from "./AboutSection"
import { BugReportSection, FeatureRequestSection } from "./FeedbackSections"

const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
const openExternalMock = vi.fn()

const { bridgeMock, downloadLogArchiveMock } = vi.hoisted(() => ({
	bridgeMock: vi.fn(),
	downloadLogArchiveMock: vi.fn(() => Promise.resolve()),
}))

vi.mock("@/lib/desktop", () => ({
	getDesktopBridge: () => bridgeMock(),
	isHoardodileDesktop: () => bridgeMock()?.isDesktop === true,
}))

vi.mock("@/lib/logArchive", () => ({
	downloadLogArchive: downloadLogArchiveMock,
}))

afterEach(() => {
	openSpy.mockClear()
	openExternalMock.mockClear()
	downloadLogArchiveMock.mockClear()
	bridgeMock.mockReset()
})

function renderAboutSections() {
	return render(
		<>
			<AboutSection />
			<BugReportSection />
			<FeatureRequestSection />
		</>,
	)
}

/** The bug form URL with the version prefilled, as the app opens it. */
function reportUrl(template: string): string {
	return `${template}&version=${encodeURIComponent(APP_VERSION)}`
}

describe("Settings → About", () => {
	test("renders the About block and one section per feedback destination", () => {
		bridgeMock.mockReturnValue(undefined)
		renderAboutSections()

		expect(screen.getByTestId("me-section-about")).toBeInTheDocument()
		expect(screen.getByTestId("me-section-bug")).toBeInTheDocument()
		expect(screen.getByTestId("me-section-feature")).toBeInTheDocument()
		// Identity: logo, update check, website / repository / developer rows.
		expect(document.querySelector('img[src="/logo.png"]')).not.toBeNull()
		expect(screen.getByTestId("me-about-check-update")).toBeInTheDocument()
		expect(screen.getByTestId("me-about-website").getAttribute("href")).toBe(
			APP_WEBSITE_URL,
		)
		expect(screen.getByTestId("me-about-repository").getAttribute("href")).toBe(
			APP_REPOSITORY_URL,
		)
		expect(screen.getByTestId("me-about-developer").getAttribute("href")).toBe(
			APP_DEVELOPER_URL,
		)
		// Report: the primary action plus the log-archive download; the
		// desktop-only server-log link must be hidden in a browser tab.
		expect(screen.getByTestId("me-feedback-bug")).toBeInTheDocument()
		expect(screen.getByTestId("me-feedback-download-logs")).toBeInTheDocument()
		expect(screen.getByTestId("me-feedback-feature").getAttribute("href")).toBe(
			APP_ISSUES_FEATURE_URL,
		)
		expect(
			screen.queryByTestId("me-feedback-open-logs"),
		).not.toBeInTheDocument()
	})

	test("a browser click opens each link in a new tab", () => {
		bridgeMock.mockReturnValue(undefined)
		renderAboutSections()

		fireEvent.click(screen.getByTestId("me-about-website"))
		expect(openSpy).toHaveBeenCalledWith(
			// The website URL is absolutized against the app origin (a bare
			// origin gains a trailing slash in URL normalization).
			new URL(APP_WEBSITE_URL, window.location.href).toString(),
			"_blank",
			"noopener,noreferrer",
		)
		fireEvent.click(screen.getByTestId("me-feedback-bug"))
		expect(openSpy).toHaveBeenCalledWith(
			reportUrl(APP_ISSUES_BUG_SELFHOSTED_URL),
			"_blank",
			"noopener,noreferrer",
		)
		fireEvent.click(screen.getByTestId("me-feedback-feature"))
		expect(openSpy).toHaveBeenCalledWith(
			APP_ISSUES_FEATURE_URL,
			"_blank",
			"noopener,noreferrer",
		)
		fireEvent.click(screen.getByTestId("me-about-developer"))
		expect(openSpy).toHaveBeenCalledWith(
			APP_DEVELOPER_URL,
			"_blank",
			"noopener,noreferrer",
		)
		expect(openExternalMock).not.toHaveBeenCalled()
	})

	test("a desktop click routes to the desktop form through the shell", () => {
		bridgeMock.mockReturnValue({
			isDesktop: true,
			openExternal: openExternalMock,
			async openLogsFolder() {
				return true
			},
		})
		render(
			<>
				<BugReportSection />
				<FeatureRequestSection />
			</>,
		)
		// Desktop also shows the quiet server-log row.
		expect(screen.getByTestId("me-feedback-open-logs")).toBeInTheDocument()

		fireEvent.click(screen.getByTestId("me-feedback-bug"))
		fireEvent.click(screen.getByTestId("me-feedback-feature"))
		expect(openExternalMock).toHaveBeenNthCalledWith(
			1,
			reportUrl(APP_ISSUES_BUG_DESKTOP_URL),
		)
		expect(openExternalMock).toHaveBeenNthCalledWith(2, APP_ISSUES_FEATURE_URL)
		expect(openSpy).not.toHaveBeenCalled()
	})

	test("downloading the log archive asks for confirmation first", async () => {
		bridgeMock.mockReturnValue(undefined)
		renderAboutSections()

		fireEvent.click(screen.getByTestId("me-feedback-download-logs"))
		// The privacy dialog must appear before anything is packed.
		expect(screen.getByTestId("me-logs-archive-confirm")).toBeInTheDocument()
		expect(downloadLogArchiveMock).not.toHaveBeenCalled()

		fireEvent.click(screen.getByTestId("me-logs-archive-confirm"))
		await waitFor(() => expect(downloadLogArchiveMock).toHaveBeenCalledTimes(1))
	})

	test("opens the server log folder on desktop only", async () => {
		const openLogsFolder = vi.fn(async () => true)
		bridgeMock.mockReturnValue({
			isDesktop: true,
			openExternal: openExternalMock,
			openLogsFolder,
		})
		render(<BugReportSection />)
		// The server-log row is the quiet desktop extra — the copy action is
		// folded into the report button.
		expect(
			screen.queryByTestId("me-feedback-copy-logs"),
		).not.toBeInTheDocument()
		fireEvent.click(screen.getByTestId("me-feedback-open-logs"))
		await waitFor(() => expect(openLogsFolder).toHaveBeenCalledTimes(1))
	})

	test("surfaces a resource-channel error in the desktop About block", async () => {
		bridgeMock.mockReturnValue(
			desktopBridge({ status: "error", message: "boom" }),
		)
		render(<AboutSection />)
		await waitFor(() =>
			expect(screen.getByTestId("me-about-update-error")).toBeInTheDocument(),
		)
	})

	test("applies a ready resource update through the bridge", async () => {
		const applied = vi.fn(async () => {})
		bridgeMock.mockReturnValue(
			desktopBridge(
				{ status: "ready", channel: "resources", version: "9.9.9" },
				{ resourceVersion: "9.9.9", apply: applied },
			),
		)
		render(<AboutSection />)
		const restart = await screen.findByTestId("me-about-restart")
		expect(restart).toHaveTextContent("Apply update")
		expect(
			await screen.findByTestId("me-about-resources-version"),
		).toHaveTextContent("Content v9.9.9")
		fireEvent.click(restart)
		await waitFor(() => expect(applied).toHaveBeenCalledTimes(1))
	})

	test("explains the update reason per channel", async () => {
		// Resources: updates automatically, keep using the app.
		bridgeMock.mockReturnValue(
			desktopBridge({
				status: "ready",
				channel: "resources",
				version: "9.9.9",
			}),
		)
		const { unmount } = render(<AboutSection />)
		await screen.findByTestId("me-about-outdated")
		expect(screen.getByText(/keep using the app/)).toBeInTheDocument()
		unmount()

		// Full: reopen the app to finish updating.
		bridgeMock.mockReturnValue(
			desktopBridge({ status: "ready", channel: "full", version: "9.9.9" }),
		)
		render(<AboutSection />)
		await screen.findByTestId("me-about-outdated")
		expect(
			screen.getByText(/reopen the app to finish updating/i),
		).toBeInTheDocument()
	})

	test("reports a newer version is available when auto-update is off", async () => {
		bridgeMock.mockReturnValue(
			desktopBridge({ status: "available", version: "9.9.9" }),
		)
		render(<AboutSection />)
		const available = await screen.findByTestId("me-about-update-available")
		expect(available).toHaveTextContent("9.9.9")
	})

	test("marks the seen update version when About is opened", async () => {
		localStorage.removeItem(prefKeys.updateLastSeenVersion)
		bridgeMock.mockReturnValue(
			desktopBridge({ status: "available", version: "9.9.9" }),
		)
		render(<AboutSection />)
		await screen.findByTestId("me-about-update-available")
		await waitFor(() =>
			expect(localStorage.getItem(prefKeys.updateLastSeenVersion)).toBe(
				"9.9.9",
			),
		)
		localStorage.removeItem(prefKeys.updateLastSeenVersion)
	})

	test("shows the applying phase in the desktop About block", async () => {
		bridgeMock.mockReturnValue(
			desktopBridge({
				status: "applying",
				channel: "resources",
				phase: "swapping",
			}),
		)
		render(<AboutSection />)
		await waitFor(() =>
			expect(screen.getByText(/Replacing server files/)).toBeInTheDocument(),
		)
	})
})

function desktopBridge(
	state: DesktopUpdateState,
	extras: {
		readonly resourceVersion?: string | null
		readonly apply?: () => Promise<void>
	} = {},
) {
	const quitAndInstall = vi.fn(async () => {})
	return {
		isDesktop: true,
		platform: "desktop",
		minimize() {},
		toggleMaximize() {},
		close() {},
		retryLoad() {},
		openExternal: openExternalMock,
		registerAppRoutes() {},
		async isMaximized() {
			return false
		},
		onMaximizedChange() {
			return () => undefined
		},
		updates: {
			portable: false,
			async status() {
				return state
			},
			onStatus() {
				return () => undefined
			},
			async check() {},
			apply: extras.apply ?? (async () => {}),
			quitAndInstall,
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
				resourceVersion: extras.resourceVersion ?? null,
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
			return { libraryPath: "" }
		},
	}
}
