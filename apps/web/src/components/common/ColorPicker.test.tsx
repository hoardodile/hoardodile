import { fireEvent, render, screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { DEFAULT_COLOR_PRESETS, TAG_SPECIAL_STYLES } from "@/lib/colors"
import { prefKeys } from "@/lib/keys"
import { prefSyncStore } from "@/lib/prefSyncStore"
import { ColorPicker } from "./ColorPicker"

describe("ColorPicker", () => {
	beforeEach(() => {
		prefSyncStore.delete(prefKeys.colorPresets)
		window.localStorage.removeItem(prefKeys.colorPresets)
	})

	it("renders the default preset colors", () => {
		render(<ColorPicker value="" onChange={vi.fn()} testId="picker" />)

		for (const color of DEFAULT_COLOR_PRESETS) {
			expect(screen.getByLabelText(color)).toBeInTheDocument()
		}
	})

	it("calls onChange when a preset is selected", () => {
		const onChange = vi.fn()
		render(<ColorPicker value="" onChange={onChange} testId="picker" />)

		fireEvent.click(screen.getByLabelText(DEFAULT_COLOR_PRESETS[1]!))

		expect(onChange).toHaveBeenCalledWith(DEFAULT_COLOR_PRESETS[1])
	})

	it("calls onChange with the native color input value", () => {
		const onChange = vi.fn()
		render(<ColorPicker value="" onChange={onChange} testId="picker" />)

		const input = screen.getByTestId("picker-input")
		fireEvent.change(input, { target: { value: "#123456" } })

		expect(onChange).toHaveBeenCalledWith("#123456")
	})

	it("clears the color when the clear button is clicked", () => {
		const onChange = vi.fn()
		render(<ColorPicker value="#E74C3C" onChange={onChange} testId="picker" />)

		fireEvent.click(screen.getByTestId("picker-clear"))

		expect(onChange).toHaveBeenCalledWith("")
	})

	it("adds the current color to user presets", () => {
		const onChange = vi.fn()
		render(<ColorPicker value="#123456" onChange={onChange} testId="picker" />)

		fireEvent.click(screen.getByTestId("picker-add-preset"))

		expect(screen.getByLabelText("#123456")).toBeInTheDocument()
		expect(
			JSON.parse(window.localStorage.getItem(prefKeys.colorPresets) ?? "[]"),
		).toEqual(["#123456"])
	})

	it("removes a user preset", () => {
		prefSyncStore.set(prefKeys.colorPresets, JSON.stringify(["#123456"]))

		const onChange = vi.fn()
		render(<ColorPicker value="" onChange={onChange} testId="picker" />)

		expect(screen.getByLabelText("#123456")).toBeInTheDocument()

		fireEvent.click(screen.getByLabelText("Remove preset #123456"))

		expect(screen.queryByLabelText("#123456")).not.toBeInTheDocument()
		expect(
			JSON.parse(window.localStorage.getItem(prefKeys.colorPresets) ?? "[]"),
		).toEqual([])
	})

	it("does not render special styles by default", () => {
		render(<ColorPicker value="" onChange={vi.fn()} testId="picker" />)

		for (const style of TAG_SPECIAL_STYLES) {
			expect(
				screen.queryByLabelText(style.charAt(0).toUpperCase() + style.slice(1)),
			).not.toBeInTheDocument()
		}
	})

	it("renders special styles when enabled", () => {
		render(
			<ColorPicker value="" onChange={vi.fn()} specialStyles testId="picker" />,
		)

		for (const style of TAG_SPECIAL_STYLES) {
			expect(
				screen.getByText(style.charAt(0).toUpperCase() + style.slice(1)),
			).toBeInTheDocument()
		}
	})

	it("selects a special style when clicked", () => {
		const onChange = vi.fn()
		render(
			<ColorPicker
				value=""
				onChange={onChange}
				specialStyles
				testId="picker"
			/>,
		)

		fireEvent.click(screen.getByText("Rainbow"))

		expect(onChange).toHaveBeenCalledWith("rainbow")
	})
})
