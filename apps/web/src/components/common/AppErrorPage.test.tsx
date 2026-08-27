import { act, fireEvent, render, screen } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { AppErrorPage } from "./AppErrorPage"

const { pushClientLogMock, flushClientLogToServerMock, formatDiagnosticsMock } =
	vi.hoisted(() => ({
		pushClientLogMock: vi.fn(),
		flushClientLogToServerMock: vi.fn(() => Promise.resolve()),
		formatDiagnosticsMock: vi.fn(() => "diagnostics block"),
	}))

vi.mock("@/lib/clientLog", () => ({
	pushClientLog: pushClientLogMock,
	flushClientLogToServer: flushClientLogToServerMock,
	formatDiagnostics: formatDiagnosticsMock,
}))

const openSpy = vi.spyOn(window, "open").mockImplementation(() => null)

beforeEach(() => {
	vi.clearAllMocks()
	Object.defineProperty(navigator, "clipboard", {
		value: { writeText: vi.fn(() => Promise.resolve()) },
		configurable: true,
	})
})

afterEach(() => {
	delete (navigator as { clipboard?: unknown }).clipboard
	openSpy.mockClear()
})

describe("AppErrorPage", () => {
	it("renders the error surface and records the error in the client log", () => {
		render(<AppErrorPage error={new Error("boom")} reset={() => {}} />)
		expect(screen.getByText("Something went wrong")).toBeInTheDocument()
		expect(screen.getByTestId("app-error-reload")).toBeInTheDocument()
		expect(screen.getByTestId("app-error-retry")).toBeInTheDocument()
		expect(pushClientLogMock).toHaveBeenCalledWith(
			"error",
			"Error: boom",
			expect.stringContaining("Error: boom"),
		)
		expect(flushClientLogToServerMock).toHaveBeenCalled()
	})

	it("copies the diagnostics block on demand", async () => {
		render(<AppErrorPage error={new Error("boom")} />)
		// act-wrapped: the copy promise resolves inside the click and the
		// copying state must settle before the assertion.
		await act(async () => {
			fireEvent.click(screen.getByTestId("app-error-copy"))
		})
		expect(navigator.clipboard.writeText).toHaveBeenCalledWith(
			"diagnostics block",
		)
	})

	it("points the report link at the matching issue template", () => {
		render(<AppErrorPage error={new Error("boom")} />)
		expect(screen.getByTestId("app-error-report").getAttribute("href")).toBe(
			"https://github.com/hoardodile/hoardodile/issues/new?template=bug_report_selfhosted.yml",
		)
	})

	it("toggles the error details", () => {
		render(<AppErrorPage error={new Error("boom")} />)
		expect(screen.queryByTestId("app-error-details")).not.toBeInTheDocument()
		fireEvent.click(screen.getByTestId("app-error-details-toggle"))
		expect(screen.getByTestId("app-error-details").textContent).toContain(
			"Error: boom",
		)
	})

	it("does not show Try again without a reset handler", () => {
		render(<AppErrorPage error={new Error("boom")} />)
		expect(screen.queryByTestId("app-error-retry")).not.toBeInTheDocument()
	})

	it("renders the standalone frame (top-level boundary) without a shell", () => {
		render(<AppErrorPage error={new Error("boom")} standalone />)
		expect(screen.getByTestId("app-error-reload")).toBeInTheDocument()
		// No AppShell: no scroll container, nothing to detect — the frame is
		// its own viewport.
		expect(document.querySelector("[data-app-scroll]")).toBeNull()
	})
})
