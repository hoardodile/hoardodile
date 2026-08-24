import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import {
	APP_DEVELOPER_URL,
	APP_ISSUES_BUG_URL,
	APP_ISSUES_FEATURE_URL,
	APP_REPOSITORY_URL,
	APP_WEBSITE_URL,
} from "@/lib/appInfo"
import { AboutSection } from "./AboutSection"
import { DeveloperSection } from "./DeveloperSection"
import { FeedbackSection } from "./FeedbackSection"

const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)
const openExternalMock = vi.fn()

const { bridgeMock } = vi.hoisted(() => ({
	bridgeMock: vi.fn(),
}))

vi.mock("@/lib/desktop", () => ({
	getDesktopBridge: () => bridgeMock(),
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
			<FeedbackSection />
			<DeveloperSection />
		</>,
	)
}

describe("Settings → About", () => {
	test("renders identity, feedback and developer blocks with the expected links", () => {
		bridgeMock.mockReturnValue(undefined)
		renderAboutSections()

		expect(screen.getByTestId("me-section-about")).toBeInTheDocument()
		expect(screen.getByTestId("me-section-feedback")).toBeInTheDocument()
		expect(screen.getByTestId("me-section-developer")).toBeInTheDocument()
		// Identity: logo, update check, website and repository rows.
		expect(document.querySelector('img[src="/logo.png"]')).not.toBeNull()
		expect(screen.getByTestId("me-about-check-update")).toBeInTheDocument()
		expect(screen.getByTestId("me-about-website").getAttribute("href")).toBe(
			APP_WEBSITE_URL,
		)
		expect(screen.getByTestId("me-about-repository").getAttribute("href")).toBe(
			APP_REPOSITORY_URL,
		)
		// Feedback: one card per issue template.
		expect(screen.getByTestId("me-feedback-bug").getAttribute("href")).toBe(
			APP_ISSUES_BUG_URL,
		)
		expect(screen.getByTestId("me-feedback-feature").getAttribute("href")).toBe(
			APP_ISSUES_FEATURE_URL,
		)
		// Developer: profile link.
		expect(
			screen.getByTestId("me-developer-profile").getAttribute("href"),
		).toBe(APP_DEVELOPER_URL)
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
			APP_ISSUES_BUG_URL,
			"_blank",
			"noopener,noreferrer",
		)
		fireEvent.click(screen.getByTestId("me-feedback-feature"))
		expect(openSpy).toHaveBeenCalledWith(
			APP_ISSUES_FEATURE_URL,
			"_blank",
			"noopener,noreferrer",
		)
		fireEvent.click(screen.getByTestId("me-developer-profile"))
		expect(openSpy).toHaveBeenCalledWith(
			APP_DEVELOPER_URL,
			"_blank",
			"noopener,noreferrer",
		)
		expect(openExternalMock).not.toHaveBeenCalled()
	})

	test("a desktop click routes through the shell instead of window.open", () => {
		bridgeMock.mockReturnValue({ openExternal: openExternalMock })
		render(
			<>
				<FeedbackSection />
				<DeveloperSection />
			</>,
		)

		fireEvent.click(screen.getByTestId("me-feedback-bug"))
		fireEvent.click(screen.getByTestId("me-developer-profile"))
		expect(openExternalMock).toHaveBeenNthCalledWith(1, APP_ISSUES_BUG_URL)
		expect(openExternalMock).toHaveBeenNthCalledWith(2, APP_DEVELOPER_URL)
		expect(openSpy).not.toHaveBeenCalled()
	})
})
