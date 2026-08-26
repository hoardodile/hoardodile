import type { DesktopUpdateState } from "@hoardodile/shared/desktop"
import { fireEvent, render, screen, waitFor } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
	APP_DEVELOPER_URL,
	APP_ISSUES_BUG_DESKTOP_URL,
	APP_ISSUES_BUG_SELFHOSTED_URL,
	APP_ISSUES_FEATURE_URL,
	APP_REPOSITORY_URL,
	APP_WEBSITE_URL,
} from "@/lib/appInfo"
import { AboutSection } from "./AboutSection"
import { BugReportSection, FeatureRequestSection } from "./FeedbackSections"

const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
const openExternalMock = vi.fn()

const { bridgeMock } = vi.hoisted(() => ({
	bridgeMock: vi.fn(),
}))

vi.mock("@/lib/desktop", () => ({
	getDesktopBridge: () => bridgeMock(),
	isHoardodileDesktop: () => bridgeMock()?.isDesktop === true,
}))

afterEach(() => {
	openSpy.mockClear()
	openExternalMock.mockClear()
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
		// Feedback: one action per issue template (browser → self-hosted form).
		expect(screen.getByTestId("me-feedback-bug").getAttribute("href")).toBe(
			APP_ISSUES_BUG_SELFHOSTED_URL,
		)
		expect(screen.getByTestId("me-feedback-feature").getAttribute("href")).toBe(
			APP_ISSUES_FEATURE_URL,
		)
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
			APP_ISSUES_BUG_SELFHOSTED_URL,
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
		})
		render(
			<>
				<BugReportSection />
				<FeatureRequestSection />
			</>,
		)
		expect(screen.getByTestId("me-feedback-bug").getAttribute("href")).toBe(
			APP_ISSUES_BUG_DESKTOP_URL,
		)

		fireEvent.click(screen.getByTestId("me-feedback-bug"))
		fireEvent.click(screen.getByTestId("me-feedback-feature"))
		expect(openExternalMock).toHaveBeenNthCalledWith(
			1,
			APP_ISSUES_BUG_DESKTOP_URL,
		)
		expect(openExternalMock).toHaveBeenNthCalledWith(2, APP_ISSUES_FEATURE_URL)
		expect(openSpy).not.toHaveBeenCalled()
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
		expect(restart).toHaveTextContent("Apply")
		expect(
			await screen.findByTestId("me-about-resources-version"),
		).toHaveTextContent("Resources v9.9.9")
		fireEvent.click(restart)
		await waitFor(() => expect(applied).toHaveBeenCalledTimes(1))
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
			return { enabled: false, port: 3000, preferredPort: 3000, addresses: [] }
		},
		async checkLanEnabled() {
			return { ok: true }
		},
		async setLanEnabled() {
			return { ok: true }
		},
		async setLanPort() {},
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
