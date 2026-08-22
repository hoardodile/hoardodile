import { TooltipProvider } from "@hoardodile/ui/components/tooltip"
import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import { TagChipToolbarButton } from "./TagChipToolbarButton.tsx"

// jsdom does not implement the APIs Radix Popover needs for positioning.
global.ResizeObserver = class {
	observe() {}
	unobserve() {}
	disconnect() {}
}
global.document.elementsFromPoint = () => []

describe("TagChipToolbarButton", () => {
	it("opens the popover and calls onPick with the selected color", async () => {
		const user = userEvent.setup()
		const onPick = vi.fn()

		render(
			<TooltipProvider>
				<TagChipToolbarButton
					label="Tag chip"
					current={undefined}
					disabled={false}
					onPick={onPick}
				/>
			</TooltipProvider>,
		)

		const trigger = screen.getByLabelText(/tag chip/i)
		await user.click(trigger)

		const swatch = screen.getByRole("button", { name: "#E74C3C" })
		await user.click(swatch)

		expect(onPick).toHaveBeenCalledWith("#E74C3C")
	})

	it("calls onPick with an empty color to remove the tag", async () => {
		const user = userEvent.setup()
		const onPick = vi.fn()

		render(
			<TooltipProvider>
				<TagChipToolbarButton
					label="Tag chip"
					current="#27AE60"
					disabled={false}
					onPick={onPick}
				/>
			</TooltipProvider>,
		)

		const trigger = screen.getByLabelText(/tag chip/i)
		await user.click(trigger)

		const clearButton = screen.getByRole("button", { name: /clear color/i })
		await user.click(clearButton)

		expect(onPick).toHaveBeenCalledWith("")
	})

	it("is pressed when there is an active chip", () => {
		render(
			<TooltipProvider>
				<TagChipToolbarButton
					label="Tag chip"
					current="#E74C3C"
					disabled={false}
					onPick={vi.fn()}
				/>
			</TooltipProvider>,
		)

		const trigger = screen.getByLabelText(/tag chip/i)
		expect(trigger).toHaveAttribute("aria-pressed", "true")
	})

	it("is not pressed when there is no active chip", () => {
		render(
			<TooltipProvider>
				<TagChipToolbarButton
					label="Tag chip"
					current={undefined}
					disabled={false}
					onPick={vi.fn()}
				/>
			</TooltipProvider>,
		)

		const trigger = screen.getByLabelText(/tag chip/i)
		expect(trigger).toHaveAttribute("aria-pressed", "false")
	})
})
