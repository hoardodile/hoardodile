import { render, screen } from "@testing-library/react"
import { describe, expect, it } from "vitest"
import { SourceChip, withScheme } from "./SourceChip"

describe("withScheme", () => {
	it("prepends https:// when the scheme is missing", () => {
		expect(withScheme("example.com/a")).toBe("https://example.com/a")
	})

	it("keeps an existing scheme", () => {
		expect(withScheme("http://example.com/a")).toBe("http://example.com/a")
	})
})

describe("SourceChip", () => {
	it("renders nothing when no source fields are set", () => {
		const { container } = render(<SourceChip />)
		expect(container).toBeEmptyDOMElement()
	})

	it("shows the source name without a link when only the name is set", () => {
		render(<SourceChip sourceName="ExampleSite" />)
		expect(screen.getByText("ExampleSite")).toBeInTheDocument()
		expect(screen.queryByTestId("source-chip-link")).not.toBeInTheDocument()
	})

	it("links the source name when a URL is set", () => {
		render(
			<SourceChip sourceName="ArtSite" sourceUrl="https://example.com/a" />,
		)
		const link = screen.getByTestId("source-chip-link")
		expect(link).toHaveAttribute("href", "https://example.com/a")
		expect(link).toHaveAttribute("target", "_blank")
		expect(link).toHaveAttribute("rel", "noopener noreferrer")
		expect(link).toHaveClass("px-2")
		expect(screen.getByText("ArtSite")).toBeInTheDocument()
	})

	it("falls back to the hostname for URL-only sources", () => {
		render(<SourceChip sourceUrl="www.example.com/art" />)
		expect(screen.getByText("example.com")).toBeInTheDocument()
		expect(screen.getByTestId("source-chip-link")).toHaveAttribute(
			"href",
			"https://www.example.com/art",
		)
	})

	it("falls back to the generic label when the URL cannot be parsed", () => {
		render(<SourceChip sourceUrl="::not-a-url" />)
		expect(screen.getByText("Source link")).toBeInTheDocument()
	})
})
