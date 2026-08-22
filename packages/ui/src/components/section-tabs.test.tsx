import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { SectionTabs } from "./section-tabs"

const ITEMS = [
	{ value: "a", label: "Alpha" },
	{ value: "b", label: "Beta" },
	{ value: "c", label: "Gamma" },
]

describe("SectionTabs", () => {
	it("renders a tablist with one tab per item and the active state", () => {
		render(<SectionTabs value="b" items={ITEMS} />)
		expect(screen.getByRole("tablist")).toBeInTheDocument()
		expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute(
			"aria-selected",
			"false",
		)
		const beta = screen.getByRole("tab", { name: "Beta" })
		expect(beta).toHaveAttribute("aria-selected", "true")
		expect(beta).toHaveAttribute("tabindex", "0")
		expect(screen.getByRole("tab", { name: "Alpha" })).toHaveAttribute(
			"tabindex",
			"-1",
		)
	})

	it("reports the picked value through onChange", () => {
		const onChange = vi.fn()
		render(<SectionTabs value="a" items={ITEMS} onChange={onChange} />)
		fireEvent.click(screen.getByRole("tab", { name: "Gamma" }))
		expect(onChange).toHaveBeenCalledWith("c")
	})

	it("moves activation and focus with the arrow keys", () => {
		const onChange = vi.fn()
		const { rerender } = render(
			<SectionTabs value="a" items={ITEMS} onChange={onChange} />,
		)
		const alpha = () => screen.getByRole("tab", { name: "Alpha" })
		const beta = () => screen.getByRole("tab", { name: "Beta" })
		const gamma = () => screen.getByRole("tab", { name: "Gamma" })

		fireEvent.keyDown(alpha(), { key: "ArrowRight" })
		expect(onChange).toHaveBeenLastCalledWith("b")
		expect(beta()).toHaveFocus()
		rerender(<SectionTabs value="b" items={ITEMS} onChange={onChange} />)

		fireEvent.keyDown(beta(), { key: "ArrowLeft" })
		expect(onChange).toHaveBeenLastCalledWith("a")
		expect(alpha()).toHaveFocus()
		rerender(<SectionTabs value="a" items={ITEMS} onChange={onChange} />)

		fireEvent.keyDown(alpha(), { key: "ArrowLeft" })
		expect(onChange).toHaveBeenLastCalledWith("c")
		rerender(<SectionTabs value="c" items={ITEMS} onChange={onChange} />)

		fireEvent.keyDown(gamma(), { key: "Home" })
		expect(onChange).toHaveBeenLastCalledWith("a")
		rerender(<SectionTabs value="a" items={ITEMS} onChange={onChange} />)

		fireEvent.keyDown(alpha(), { key: "End" })
		expect(onChange).toHaveBeenLastCalledWith("c")
	})

	it("mounts only the active panel and links it to the active tab", () => {
		const { rerender } = render(
			<SectionTabs
				value="a"
				items={[
					{ ...ITEMS[0]!, panel: <p>Panel Alpha</p> },
					{ ...ITEMS[1]!, panel: <p>Panel Beta</p> },
				]}
			/>,
		)
		const panel = screen.getByRole("tabpanel")
		expect(panel).toHaveTextContent("Panel Alpha")
		expect(panel).toHaveAttribute(
			"aria-labelledby",
			screen.getByRole("tab", { name: "Alpha" }).id,
		)
		expect(screen.queryByText("Panel Beta")).not.toBeInTheDocument()

		rerender(
			<SectionTabs
				value="b"
				items={[
					{ ...ITEMS[0]!, panel: <p>Panel Alpha</p> },
					{ ...ITEMS[1]!, panel: <p>Panel Beta</p> },
				]}
			/>,
		)
		expect(screen.getByRole("tabpanel")).toHaveTextContent("Panel Beta")
		expect(screen.queryByText("Panel Alpha")).not.toBeInTheDocument()
	})

	it("replaces the default panel spacing per item", () => {
		render(
			<SectionTabs
				value="a"
				items={[
					{
						...ITEMS[0]!,
						panelClassName: "pt-3",
						panel: <p>Panel Alpha</p>,
					},
				]}
			/>,
		)
		expect(screen.getByRole("tabpanel").className).toContain("pt-3")
		expect(screen.getByRole("tabpanel").className).not.toContain("mt-4")
	})

	it("lets a render slot replace the trigger with ARIA props to spread", () => {
		render(
			<SectionTabs
				value="a"
				items={[
					{
						...ITEMS[0]!,
						testId: "link-tab",
						render: (active, className, trigger) => (
							<a
								href="/alpha"
								{...trigger}
								className={className}
								data-active={active}
							>
								Alpha link
							</a>
						),
					},
					{ ...ITEMS[1]!, label: "Beta" },
				]}
			/>,
		)
		const link = screen.getByTestId("link-tab")
		expect(link).toHaveAttribute("role", "tab")
		expect(link).toHaveAttribute("aria-selected", "true")
		expect(link.className).toContain("uppercase")
		expect(screen.getByRole("tab", { name: "Beta" })).toBeInTheDocument()
	})

	it("renders the right-hand controls in the tab row", () => {
		render(
			<SectionTabs
				value="a"
				items={ITEMS}
				controls={<span data-testid="row-control">Sort</span>}
			/>,
		)
		expect(screen.getByTestId("row-control")).toBeInTheDocument()
	})
})
