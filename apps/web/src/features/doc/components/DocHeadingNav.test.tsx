import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { DocHeadingNav } from "./DocHeadingNav"

describe("DocHeadingNav", () => {
	const headings = [
		{ id: "a", level: 1, text: "Intro" },
		{ id: "b", level: 2, text: "Middle" },
		{ id: "c", level: 3, text: "Detail" },
	]

	it("renders a level label and title per heading", () => {
		render(<DocHeadingNav headings={headings} onNavigate={vi.fn()} />)

		expect(screen.getByText("H1")).toBeInTheDocument()
		expect(screen.getByText("H2")).toBeInTheDocument()
		expect(screen.getByText("H3")).toBeInTheDocument()
		expect(screen.getByText("Intro")).toBeInTheDocument()
		expect(screen.getByText("Middle")).toBeInTheDocument()
		expect(screen.getByText("Detail")).toBeInTheDocument()
	})

	it("indents rows 16px per level and weights H3 lighter", () => {
		render(<DocHeadingNav headings={headings} onNavigate={vi.fn()} />)

		const h1 = screen.getByRole("button", { name: /Intro/ })
		const h3 = screen.getByRole("button", { name: /Detail/ })
		expect(h1.style.paddingLeft).toBe("0.5rem")
		expect(h3.style.paddingLeft).toBe("2.5rem")
		expect(screen.getByText("Middle")).toHaveClass("font-semibold")
		expect(screen.getByText("Detail")).not.toHaveClass("font-semibold")
	})

	it("marks the first heading active before any interaction", () => {
		render(<DocHeadingNav headings={headings} onNavigate={vi.fn()} />)

		const first = screen.getByRole("button", { name: /Intro/ })
		expect(first).toHaveAttribute("aria-current", "true")
		expect(first).toHaveClass("border-foreground")
	})

	it("navigates and moves the active bar on click", async () => {
		const user = userEvent.setup()
		const onNavigate = vi.fn()
		render(<DocHeadingNav headings={headings} onNavigate={onNavigate} />)

		const target = screen.getByRole("button", { name: /Middle/ })
		await user.click(target)

		expect(onNavigate).toHaveBeenCalledWith("b")
		expect(target).toHaveAttribute("aria-current", "true")
		expect(target).toHaveClass("border-foreground")
	})

	it("renders the empty state without headings", () => {
		render(<DocHeadingNav headings={[]} onNavigate={vi.fn()} />)

		expect(screen.getByText(/no headings/i)).toBeInTheDocument()
	})
})
