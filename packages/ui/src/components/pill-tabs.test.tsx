import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { PillTabs, pillButtonClassName } from "./pill-tabs"

describe("pillButtonClassName", () => {
	it("uses the chip-sized pill", () => {
		expect(pillButtonClassName(false)).toContain("h-chip px-3")
	})

	it("lifts the active pill to the card fill", () => {
		// tailwind-merge reorders classes — assert tokens, not a sequence.
		const active = pillButtonClassName(true)
		expect(active).toContain("bg-card")
		expect(active).toContain("font-medium")
		expect(active).toContain("text-foreground")
		expect(pillButtonClassName(false)).not.toContain("bg-card")
	})
})

describe("PillTabs", () => {
	const items = [
		{ value: "a", label: "Alpha" },
		{ value: "b", label: "Beta" },
	]

	it("renders the track with one button per item and the active state", () => {
		render(<PillTabs value="b" items={items} />)
		expect(screen.getByRole("button", { name: "Alpha" })).toBeInTheDocument()
		const beta = screen.getByRole("button", { name: "Beta" })
		expect(beta.className).toContain("bg-card")
		expect(
			screen.getByRole("button", { name: "Alpha" }).className,
		).not.toContain("bg-card")
	})

	it("reports the picked value through onChange", () => {
		const onChange = vi.fn()
		render(<PillTabs value="a" items={items} onChange={onChange} />)
		fireEvent.click(screen.getByRole("button", { name: "Beta" }))
		expect(onChange).toHaveBeenCalledWith("b")
	})

	it("lets a render slot replace the button (Link-style items)", () => {
		render(
			<PillTabs
				value="a"
				items={[
					{
						value: "a",
						label: "Alpha",
						render: (active, className) => (
							<a href="/stats" className={className} data-active={active}>
								Alpha link
							</a>
						),
					},
				]}
			/>,
		)
		const link = screen.getByRole("link", { name: "Alpha link" })
		expect(link.getAttribute("data-active")).toBe("true")
		expect(link.className).toContain("bg-card")
	})

	it("announces the active pill via aria-pressed when requested", () => {
		render(
			<PillTabs
				value="a"
				items={items.map((item) => ({
					...item,
					ariaPressed: item.value === "a",
				}))}
			/>,
		)
		expect(screen.getByRole("button", { name: "Alpha" })).toHaveAttribute(
			"aria-pressed",
			"true",
		)
		expect(screen.getByRole("button", { name: "Beta" })).toHaveAttribute(
			"aria-pressed",
			"false",
		)
	})
})
