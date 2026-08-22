import { render, screen } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { describe, expect, it, vi } from "vitest"
import {
	CaptionBar,
	type CaptionHistoryControls,
	type CaptionWindowControls,
} from "./caption-bar"

function fakeControls(
	overrides: Partial<CaptionWindowControls> = {},
): CaptionWindowControls {
	return {
		minimize: vi.fn(),
		toggleMaximize: vi.fn(),
		close: vi.fn(),
		isMaximized: async () => false,
		onMaximizedChange: () => () => undefined,
		...overrides,
	}
}

function fakeHistory(
	overrides: Partial<CaptionHistoryControls> = {},
): CaptionHistoryControls {
	return {
		canGoBack: true,
		canGoForward: true,
		back: vi.fn(),
		forward: vi.fn(),
		reload: vi.fn(),
		...overrides,
	}
}

describe("CaptionBar", () => {
	it("invokes window controls from the caption buttons", async () => {
		const user = userEvent.setup()
		const controls = fakeControls()
		render(<CaptionBar controls={controls} history={fakeHistory()} />)

		await user.click(screen.getByTestId("desktop-caption-minimize"))
		await user.click(screen.getByTestId("desktop-caption-maximize"))
		await user.click(screen.getByTestId("desktop-caption-close"))

		expect(controls.minimize).toHaveBeenCalledTimes(1)
		expect(controls.toggleMaximize).toHaveBeenCalledTimes(1)
		expect(controls.close).toHaveBeenCalledTimes(1)
		expect(screen.queryByText("hoardodile")).toBeNull()
	})

	it("toggles maximize on double-click of the drag region", async () => {
		const user = userEvent.setup()
		const controls = fakeControls()
		render(<CaptionBar controls={controls} history={fakeHistory()} />)

		await user.dblClick(screen.getByTestId("desktop-caption-drag"))
		expect(controls.toggleMaximize).toHaveBeenCalledTimes(1)
	})

	it("invokes history controls from the navigation buttons", async () => {
		const user = userEvent.setup()
		const history = fakeHistory()
		render(<CaptionBar controls={fakeControls()} history={history} />)

		await user.click(screen.getByTestId("desktop-caption-back"))
		await user.click(screen.getByTestId("desktop-caption-forward"))
		await user.click(screen.getByTestId("desktop-caption-reload"))

		expect(history.back).toHaveBeenCalledTimes(1)
		expect(history.forward).toHaveBeenCalledTimes(1)
		expect(history.reload).toHaveBeenCalledTimes(1)
	})

	it("disables back and forward when the stack cannot move", () => {
		render(
			<CaptionBar
				controls={fakeControls()}
				history={fakeHistory({ canGoBack: false, canGoForward: false })}
			/>,
		)

		expect(screen.getByTestId("desktop-caption-back")).toBeDisabled()
		expect(screen.getByTestId("desktop-caption-forward")).toBeDisabled()
		expect(screen.getByTestId("desktop-caption-reload")).toBeEnabled()
	})
})
