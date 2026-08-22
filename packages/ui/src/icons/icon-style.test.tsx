import { BoltIcon as BoltBoldWeight } from "@solar-icons/react/bold/bolt"
import { BoltIcon as BoltBoldDuotone } from "@solar-icons/react/bold-duotone/bolt"
import { BoltIcon as BoltLinear } from "@solar-icons/react/linear/bolt"
import { act, render, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it } from "vitest"
import { createIcon } from "./icon-style"

const Bolt = createIcon({
	bold: BoltBoldWeight,
	boldDuotone: BoltBoldDuotone,
	linear: BoltLinear,
})

function svgClass(container: HTMLElement): string | null {
	return container.querySelector("svg")?.getAttribute("class") ?? null
}

function setIconStyle(style: "duotone" | "grayscale" | "linear" | undefined) {
	act(() => {
		if (style === undefined) {
			delete document.documentElement.dataset.iconStyle
		} else {
			document.documentElement.dataset.iconStyle = style
		}
	})
}

beforeEach(() => {
	delete document.documentElement.dataset.iconStyle
})

describe("createIcon", () => {
	it("renders the boldDuotone glyph by default with the hd-icon hook", () => {
		const { container } = render(<Bolt className="size-4" />)
		expect(svgClass(container)).toContain("solar-bolt-bold-duotone")
		expect(svgClass(container)).toContain("hd-icon")
		expect(svgClass(container)).toContain("size-4")
	})

	it("swaps to the linear glyph in linear style", async () => {
		const { container } = render(<Bolt />)
		setIconStyle("linear")
		await waitFor(() => {
			expect(svgClass(container)).toContain("solar-bolt-linear")
		})
	})

	it("restores the boldDuotone glyph when the style leaves linear", async () => {
		const { container } = render(<Bolt />)
		setIconStyle("linear")
		await waitFor(() => {
			expect(svgClass(container)).toContain("solar-bolt-linear")
		})
		setIconStyle("grayscale")
		await waitFor(() => {
			expect(svgClass(container)).toContain("solar-bolt-bold-duotone")
		})
	})

	it("renders the bold glyph when the mode prop is set", () => {
		const { container } = render(<Bolt mode="bold" />)
		expect(svgClass(container)).toContain("solar-bolt-bold")
	})

	it("renders each mode explicitly", () => {
		const { container } = render(<Bolt mode="linear" />)
		expect(svgClass(container)).toContain("solar-bolt-linear")
	})
})
