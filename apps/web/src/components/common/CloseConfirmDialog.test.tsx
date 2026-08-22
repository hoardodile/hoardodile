import { fireEvent, render, screen } from "@testing-library/react"
import { describe, expect, it, vi } from "vitest"
import { CloseConfirmDialog } from "./CloseConfirmDialog"

function renderDialog(props?: {
	onDecide?: (action: "tray" | "quit", remember: boolean) => void
}) {
	const onDecide = props?.onDecide ?? vi.fn()
	const onOpenChange = vi.fn()
	render(
		<CloseConfirmDialog
			open={true}
			onOpenChange={onOpenChange}
			onDecide={onDecide}
		/>,
	)
	return { onDecide, onOpenChange }
}

describe("CloseConfirmDialog", () => {
	it("asks to quit - or hide to tray - with cancel and a remember checkbox", () => {
		renderDialog()
		expect(screen.getByText("Close hoardodile?")).toBeTruthy()
		expect(screen.getByText("Remember my choice")).toBeTruthy()
		expect(screen.getByTestId("close-confirm-cancel")).toBeTruthy()
		expect(screen.getByTestId("close-confirm-quit")).toBeTruthy()
		expect(screen.getByTestId("close-confirm-tray")).toBeTruthy()
	})

	it("cancels without deciding", () => {
		const { onDecide, onOpenChange } = renderDialog()
		fireEvent.click(screen.getByTestId("close-confirm-cancel"))
		expect(onOpenChange).toHaveBeenCalledWith(false)
		expect(onDecide).not.toHaveBeenCalled()
	})

	it("reports the chosen action and the remember state", () => {
		const { onDecide } = renderDialog()
		fireEvent.click(screen.getByTestId("close-confirm-remember"))
		fireEvent.click(screen.getByTestId("close-confirm-tray"))
		expect(onDecide).toHaveBeenCalledWith("tray", true)
		fireEvent.click(screen.getByTestId("close-confirm-remember"))
		fireEvent.click(screen.getByTestId("close-confirm-quit"))
		expect(onDecide).toHaveBeenCalledWith("quit", false)
	})
})
