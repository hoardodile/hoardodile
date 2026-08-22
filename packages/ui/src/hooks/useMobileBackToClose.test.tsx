import { act, cleanup, render } from "@testing-library/react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import {
	setNavigationResolver,
	useMobileBackToClose,
} from "./useMobileBackToClose"

const HISTORY_KEY = "__appMobileOverlay"

function Overlay({
	open,
	onOpenChange,
}: {
	open: boolean
	onOpenChange: (open: boolean) => void
}) {
	useMobileBackToClose(open, onOpenChange)
	return null
}

function dispatchPop(state: unknown): void {
	window.dispatchEvent(new PopStateEvent("popstate", { state }))
}

describe("useMobileBackToClose", () => {
	beforeEach(() => {
		vi.stubGlobal("matchMedia", () => ({ matches: true }))
		// Simulate the production resolver: it only fires on actual route
		// transitions, so UI-only closes must fall back to rAF cleanup.
		setNavigationResolver(() => () => {})
	})

	afterEach(() => {
		vi.unstubAllGlobals()
		cleanup()
		// Reset history.state between tests so each test starts from a
		// clean base entry.
		window.history.replaceState(null, "")
	})

	it("closes a single overlay when the back gesture returns to the base state", () => {
		const onClose = vi.fn()
		render(<Overlay open onOpenChange={onClose} />)

		expect(window.history.state).toHaveProperty(HISTORY_KEY)

		act(() => {
			dispatchPop(null)
		})

		expect(onClose).toHaveBeenCalledWith(false)
	})

	it("closes nested overlays from top to bottom", () => {
		const sheetClose = vi.fn()
		const dialogClose = vi.fn()

		const { rerender } = render(
			<>
				<Overlay open onOpenChange={sheetClose} />
				<Overlay open={false} onOpenChange={dialogClose} />
			</>,
		)

		const sheetState = window.history.state
		expect(sheetState).toHaveProperty(HISTORY_KEY)

		rerender(
			<>
				<Overlay open onOpenChange={sheetClose} />
				<Overlay open onOpenChange={dialogClose} />
			</>,
		)

		const dialogState = window.history.state
		expect(dialogState).toHaveProperty(HISTORY_KEY)
		expect(dialogState[HISTORY_KEY]).not.toBe(sheetState[HISTORY_KEY])

		// Back from dialog lands on the sheet's synthetic entry.
		act(() => {
			dispatchPop(sheetState)
		})
		expect(dialogClose).toHaveBeenCalledWith(false)
		expect(sheetClose).not.toHaveBeenCalled()

		// Back from sheet lands on the base route state.
		act(() => {
			dispatchPop(null)
		})
		expect(sheetClose).toHaveBeenCalledWith(false)
	})

	it("does not let a closing lower overlay unwind history on top of a newly opened one", async () => {
		const menuClose = vi.fn()
		const dialogClose = vi.fn()

		const { rerender } = render(<Overlay open onOpenChange={menuClose} />)

		const menuState = window.history.state
		expect(menuState).toHaveProperty(HISTORY_KEY)

		// Close menu and open dialog in the same commit.
		rerender(
			<>
				<Overlay open={false} onOpenChange={menuClose} />
				<Overlay open onOpenChange={dialogClose} />
			</>,
		)

		// Let the menu's deferred cleanup check run.
		await act(async () => {
			await new Promise((resolve) => requestAnimationFrame(resolve))
		})

		// The dialog's synthetic entry must still be current; the menu
		// cleanup should NOT have called history.back() and replaced the
		// state with the menu's base state.
		const state = window.history.state
		expect(state).toHaveProperty(HISTORY_KEY)
		expect(state[HISTORY_KEY]).not.toBe(menuState[HISTORY_KEY])
	})

	it("cleans up the synthetic entry on UI close even when the navigation resolver never fires", async () => {
		const onClose = vi.fn()
		const { rerender } = render(<Overlay open onOpenChange={onClose} />)

		expect(window.history.state).toHaveProperty(HISTORY_KEY)

		rerender(<Overlay open={false} onOpenChange={onClose} />)

		// Wait for the rAF check, then for the asynchronous popstate that
		// fires after history.back() completes.
		await act(async () => {
			await new Promise((resolve) => requestAnimationFrame(resolve))
			await new Promise((resolve) => setTimeout(resolve, 100))
		})

		expect(HISTORY_KEY in (window.history.state ?? {})).toBe(false)
	})
})
