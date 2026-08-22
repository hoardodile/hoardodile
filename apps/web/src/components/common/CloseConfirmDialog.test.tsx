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
		// Three-button footer (DESIGN.md — Overlays): the secondary function
		// key (quit) leads, cancel and the primary action follow.
		const quit = screen.getByTestId("close-confirm-quit")
		const cancel = screen.getByTestId("close-confirm-cancel")
		const tray = screen.getByTestId("close-confirm-tray")
		expect(
			quit.compareDocumentPosition(cancel) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
		expect(
			quit.compareDocumentPosition(tray) & Node.DOCUMENT_POSITION_FOLLOWING,
		).toBeTruthy()
	})

	it("cancels without deciding", () => {
		const { onDecide, onOpenChange } = renderDialog()
		fireEvent.click(screen.getByTestId("close-confirm-cancel"))
		expect(onOpenChange).toHaveBeenCalledWith(false)
		expect(onDecide).not.toHaveBeenCalled()
	})

	it("only the checkbox toggles the remembered choice", () => {
		const { onDecide } = renderDialog()
		// The row is not a label: clicking the text must not check the box.
		fireEvent.click(screen.getByText("Remember my choice"))
		fireEvent.click(screen.getByTestId("close-confirm-tray"))
		expect(onDecide).toHaveBeenLastCalledWith("tray", false)
		fireEvent.click(screen.getByRole("checkbox"))
		fireEvent.click(screen.getByTestId("close-confirm-tray"))
		expect(onDecide).toHaveBeenLastCalledWith("tray", true)
	})

	it("reports the chosen action and the remember state", () => {
		const { onDecide } = renderDialog()
		fireEvent.click(screen.getByRole("checkbox"))
		fireEvent.click(screen.getByTestId("close-confirm-tray"))
		expect(onDecide).toHaveBeenCalledWith("tray", true)
		fireEvent.click(screen.getByRole("checkbox"))
		fireEvent.click(screen.getByTestId("close-confirm-quit"))
		expect(onDecide).toHaveBeenCalledWith("quit", false)
	})

	it("forgets the remembered choice once the dialog closes", () => {
		const onDecide = vi.fn()
		const onOpenChange = vi.fn()
		const { rerender } = render(
			<CloseConfirmDialog
				open={true}
				onOpenChange={onOpenChange}
				onDecide={onDecide}
			/>,
		)
		fireEvent.click(screen.getByRole("checkbox"))
		fireEvent.click(screen.getByTestId("close-confirm-tray"))
		expect(onDecide).toHaveBeenLastCalledWith("tray", true)
		// Close, then reopen: the checkbox must start unchecked again, so a
		// stale check cannot re-persist the old action and silently undo a
		// change the user made in Settings → App in the meantime.
		rerender(
			<CloseConfirmDialog
				open={false}
				onOpenChange={onOpenChange}
				onDecide={onDecide}
			/>,
		)
		rerender(
			<CloseConfirmDialog
				open={true}
				onOpenChange={onOpenChange}
				onDecide={onDecide}
			/>,
		)
		fireEvent.click(screen.getByTestId("close-confirm-tray"))
		expect(onDecide).toHaveBeenLastCalledWith("tray", false)
	})
})
