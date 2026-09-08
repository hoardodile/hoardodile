import { act, cleanup, render, renderHook } from "@testing-library/react"
import { type ReactNode, StrictMode, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { createMobileBackController } from "../lib/mobile-back-controller"
import { createBackHistory } from "../test/back-history"
import {
	MobileBackProvider,
	useMobileBackToClose,
} from "./useMobileBackToClose"

afterEach(cleanup)

function setup(enabled = true) {
	const browser = createBackHistory()
	const controller = createMobileBackController({
		driver: browser.driver,
		schedule: browser.schedule,
		enabled,
	})
	const wrapper = ({ children }: { children: ReactNode }) => (
		<MobileBackProvider registry={controller}>{children}</MobileBackProvider>
	)
	const settle = () => act(() => browser.settle())
	return { browser, controller, wrapper, settle }
}

describe("useMobileBackToClose", () => {
	it("is inert when closed, not mobile, or missing a close callback", async () => {
		const { browser, controller, wrapper, settle } = setup(false)
		const { rerender } = renderHook(
			({ open, close }) => useMobileBackToClose(open, close),
			{
				initialProps: {
					open: true,
					close: vi.fn() as ((open: boolean) => void) | undefined,
				},
				wrapper,
			},
		)
		await settle()
		expect(browser.index).toBe(1)
		controller.setEnabled(true)
		rerender({ open: false, close: vi.fn() })
		await settle()
		expect(browser.index).toBe(1)
		rerender({ open: true, close: undefined })
		await settle()
		expect(browser.index).toBe(1)
	})

	it("uses the latest callback and restores protection when controlled state refuses the close", async () => {
		const { browser, controller, wrapper, settle } = setup()
		const first = vi.fn()
		const latest = vi.fn()
		const { rerender } = renderHook(
			({ close }) => useMobileBackToClose(true, close),
			{ wrapper, initialProps: { close: first } },
		)
		await settle()
		rerender({ close: latest })
		await settle()
		act(() => controller.go(-1))
		await settle()
		expect(first).not.toHaveBeenCalled()
		expect(latest).toHaveBeenCalledExactlyOnceWith(false)
		expect(browser.index).toBe(2)
	})

	it("coalesces StrictMode remounts and releases registrations on unmount", async () => {
		const { browser, controller, settle } = setup()
		function Example() {
			const [open, setOpen] = useState(true)
			useMobileBackToClose(open, setOpen)
			return <output>{open ? "open" : "closed"}</output>
		}
		const rendered = render(
			<StrictMode>
				<MobileBackProvider registry={controller}>
					<Example />
				</MobileBackProvider>
			</StrictMode>,
		)
		await settle()
		expect(browser.index).toBe(2)
		expect(controller.snapshot.overlays).toHaveLength(1)
		act(() => controller.go(-1))
		await settle()
		expect(rendered.getByText("closed")).toBeInTheDocument()
		rendered.unmount()
		await settle()
		expect(browser.index).toBe(1)
		expect(controller.snapshot.registrations).toBe(0)
	})

	it("does not change an unrelated browser history implementation", async () => {
		const push = window.history.pushState
		const replace = window.history.replaceState
		const { wrapper, settle } = setup()
		renderHook(() => useMobileBackToClose(true, vi.fn()), { wrapper })
		await settle()
		expect(window.history.pushState).toBe(push)
		expect(window.history.replaceState).toBe(replace)
	})
})
