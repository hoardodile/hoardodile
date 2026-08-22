import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, test, vi } from "vitest"
import { TAG_SPECIAL_STYLES } from "@/lib/colors"
import { TagChip } from "./TagChip"

function mockBoundingRect(width: number, height: number) {
	const original = Element.prototype.getBoundingClientRect
	Element.prototype.getBoundingClientRect = vi.fn(() =>
		DOMRect.fromRect({ x: 0, y: 0, width, height }),
	)
	return () => {
		Element.prototype.getBoundingClientRect = original
	}
}

describe("TagChip", () => {
	test("renders a plain span with a single text wrapper (no layered nesting)", () => {
		const { container } = render(<TagChip color="">tag</TagChip>)
		const chip = container.firstElementChild
		expect(chip).toHaveTextContent("tag")
		expect(chip).not.toHaveClass("border")
		expect(chip?.querySelectorAll("span")).toHaveLength(1)
	})

	test("renders normal colored chips with the tinted fill variables", () => {
		const { container } = render(<TagChip color="#E74C3C">tag</TagChip>)
		const chip = container.firstElementChild as HTMLElement
		expect(chip.style.getPropertyValue("--chip-bg")).toContain("#E74C3C")
		expect(chip).toHaveStyle({ color: "#E74C3C" })
	})

	test("renders every registered special style with an SVG texture", () => {
		for (const style of TAG_SPECIAL_STYLES) {
			const { container } = render(<TagChip color={style}>tag</TagChip>)
			expect(container.querySelector("svg")).toBeInTheDocument()
		}
	})

	test("falls back to the default palette when color is empty", () => {
		const { container } = render(<TagChip color="">tag</TagChip>)
		expect(container.firstElementChild).toHaveTextContent("tag")
	})

	test("an onClick handler promotes the chip to a real button", async () => {
		const user = userEvent.setup()
		const onClick = vi.fn()
		render(
			<TagChip color="" onClick={onClick} data-testid="chip">
				hello
			</TagChip>,
		)
		const el = screen.getByTestId("chip")
		expect(el.tagName).toBe("BUTTON")
		await user.click(el)
		expect(onClick).toHaveBeenCalledTimes(1)
	})

	test("display mode stays a span", () => {
		render(
			<TagChip color="" data-testid="chip">
				hello
			</TagChip>,
		)
		expect(screen.getByTestId("chip").tagName).toBe("SPAN")
	})

	test("render swaps the root element and keeps the chip's children", () => {
		render(
			<TagChip color="" data-testid="chip" render={<button type="button" />}>
				label
			</TagChip>,
		)
		const el = screen.getByTestId("chip")
		expect(el.tagName).toBe("BUTTON")
		expect(el).toHaveTextContent("label")
	})

	test("active uncolored chips take the primary palette", () => {
		render(
			<TagChip color="" active onClick={() => undefined} data-testid="chip">
				x
			</TagChip>,
		)
		const el = screen.getByTestId("chip")
		expect(el.className).toContain("bg-primary")
		expect(el.className).toContain("text-primary-foreground")
	})

	test("dashed border mode renders the quiet outline and ignores color", () => {
		render(
			<TagChip color="#ff0000" border="dashed" data-testid="chip">
				x
			</TagChip>,
		)
		const el = screen.getByTestId("chip")
		expect(el.className).toContain("border-dashed")
		expect(el.className).toContain("border-border-strong")
		expect(el.className).toContain("text-muted-foreground")
		expect(el.className).not.toContain("bg-primary")
	})

	test("dashed border mode active swaps in the accent fill with a transparent border", () => {
		render(
			<TagChip
				color=""
				active
				border="dashed"
				onClick={() => undefined}
				data-testid="chip"
			>
				x
			</TagChip>,
		)
		const el = screen.getByTestId("chip")
		expect(el.className).toContain("bg-accent")
		expect(el.className).toContain("border-transparent")
	})

	test("roundedRight=false removes the right border-radius", () => {
		render(
			<TagChip color="" roundedRight={false} data-testid="chip">
				x
			</TagChip>,
		)
		expect(screen.getByTestId("chip").className).toContain("rounded-r-none")
	})

	test("special style renders an SVG gradient surface", () => {
		const restore = mockBoundingRect(100, 36)
		render(
			<TagChip color="rainbow" data-testid="chip">
				rainbow
			</TagChip>,
		)
		const el = screen.getByTestId("chip")
		expect(el.querySelector("svg")).toBeInTheDocument()
		expect(el.querySelector("linearGradient")).toBeInTheDocument()
		restore()
	})

	test("special style active state uses the active fill", () => {
		const restore = mockBoundingRect(100, 36)
		render(
			<TagChip color="gold" active data-testid="chip">
				gold
			</TagChip>,
		)
		const rect = screen.getByTestId("chip").querySelector("rect")
		expect(rect).toHaveAttribute("fill", "#8a6d1f")
		restore()
	})

	test("special style does not apply the regular border or tint classes", () => {
		render(
			<TagChip color="silver" data-testid="chip">
				silver
			</TagChip>,
		)
		const el = screen.getByTestId("chip")
		expect(el.className).not.toContain("border-transparent")
		expect(el.className).not.toContain(" bg-(--chip-bg)")
	})
})
