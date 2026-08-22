import { fireEvent, render, screen } from "@testing-library/react"
import { afterEach, describe, expect, test, vi } from "vitest"
import { ExternalLink, openExternalUrl } from "./ExternalLink"

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

function renderExternal(href: string) {
	render(<ExternalLink href={href}>label</ExternalLink>)
	return screen.getByText("label").closest("a")
}

describe("ExternalLink", () => {
	test("renders a real anchor without a target attribute", () => {
		const anchor = renderExternal("https://example.com/x")
		expect(anchor).not.toBeNull()
		expect(anchor?.getAttribute("href")).toBe("https://example.com/x")
		expect(anchor?.getAttribute("rel")).toBe("noopener noreferrer")
		expect(anchor?.hasAttribute("target")).toBe(false)
	})

	test("a browser click opens a new tab", () => {
		bridgeMock.mockReturnValue(undefined)
		const anchor = renderExternal("https://example.com/x")
		expect(anchor).not.toBeNull()
		fireEvent.click(anchor!)
		expect(openSpy).toHaveBeenCalledWith(
			"https://example.com/x",
			"_blank",
			"noopener,noreferrer",
		)
		expect(openExternalMock).not.toHaveBeenCalled()
	})

	test("a desktop click routes through the shell instead of window.open", () => {
		bridgeMock.mockReturnValue({ openExternal: openExternalMock })
		const anchor = renderExternal("https://example.com/x")
		expect(anchor).not.toBeNull()
		fireEvent.click(anchor!)
		expect(openExternalMock).toHaveBeenCalledWith("https://example.com/x")
		expect(openSpy).not.toHaveBeenCalled()
	})

	test("relative hrefs are absolutized for the shell", () => {
		bridgeMock.mockReturnValue({ openExternal: openExternalMock })
		const anchor = renderExternal("/LICENSE")
		expect(anchor).not.toBeNull()
		fireEvent.click(anchor!)
		expect(openExternalMock).toHaveBeenCalledWith(
			new URL("/LICENSE", window.location.href).toString(),
		)
	})

	test("composes a caller onClick", () => {
		const click = vi.fn()
		render(
			<ExternalLink href="https://example.com/x" onClick={click}>
				label
			</ExternalLink>,
		)
		fireEvent.click(screen.getByText("label"))
		expect(click).toHaveBeenCalledTimes(1)
	})
})

describe("openExternalUrl", () => {
	test("browser: window.open a new tab", () => {
		bridgeMock.mockReturnValue(undefined)
		openExternalUrl("https://example.com/x")
		expect(openSpy).toHaveBeenCalledWith(
			"https://example.com/x",
			"_blank",
			"noopener,noreferrer",
		)
	})

	test("desktop: bridge.openExternal, never window.open", () => {
		bridgeMock.mockReturnValue({ openExternal: openExternalMock })
		openExternalUrl("https://example.com/x")
		expect(openExternalMock).toHaveBeenCalledWith("https://example.com/x")
		expect(openSpy).not.toHaveBeenCalled()
	})
})
