import { act, cleanup, render } from "@testing-library/react"
import { type ReactNode, useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { MobileBackProvider } from "../hooks/useMobileBackToClose"
import { createMobileBackController } from "../lib/mobile-back-controller"
import { createBackHistory } from "../test/back-history"
import { Combobox } from "./combobox"
import { Dialog } from "./dialog"
import { DropdownMenu, DropdownMenuSub } from "./dropdown-menu"
import { Popover } from "./popover"
import { Sheet } from "./sheet"
import { MobileDrawer } from "./mobile-drawer"

afterEach(cleanup)

const cases: [string, (close: (open: boolean) => void) => ReactNode][] = [
	["Dialog", (close) => <Dialog defaultOpen onOpenChange={close} />],
	["Sheet", (close) => <Sheet defaultOpen onOpenChange={close} />],
	["Popover", (close) => <Popover defaultOpen onOpenChange={close} />],
	["DropdownMenu", (close) => <DropdownMenu defaultOpen onOpenChange={close} />],
	["Combobox", (close) => <Combobox defaultOpen onOpenChange={close} />],
]

describe("mobile back component adapters", () => {
	it("keeps a drawer open while returning from its dialog, then closes the drawer", async () => {
		const browser = createBackHistory()
		const controller = createMobileBackController({ driver: browser.driver, schedule: browser.schedule, enabled: true })
		function Example() {
			const [drawer, setDrawer] = useState(true)
			return <MobileDrawer open={drawer} onOpenChange={setDrawer}>
				<output>{drawer ? "drawer open" : "drawer closed"}</output>
				<Dialog defaultOpen />
			</MobileDrawer>
		}
		const view = render(<MobileBackProvider registry={controller}><Example /></MobileBackProvider>)
		await act(() => browser.settle())
		expect(controller.snapshot.overlays).toHaveLength(2)
		act(() => controller.go(-1))
		await act(() => browser.settle())
		expect(view.getByText("drawer open")).toBeInTheDocument()
		expect(controller.snapshot.overlays).toHaveLength(1)
		act(() => controller.go(-1))
		await act(() => browser.settle())
		expect(view.getByText("drawer closed")).toBeInTheDocument()
		expect(browser.index).toBe(1)
		controller.dispose()
	})
	it.each(cases)("%s accepts a browser close in uncontrolled mode", async (_name, component) => {
		const browser = createBackHistory()
		const controller = createMobileBackController({ driver: browser.driver, schedule: browser.schedule, enabled: true })
		const close = vi.fn()
		render(<MobileBackProvider registry={controller}>{component(close)}</MobileBackProvider>)
		await act(() => browser.settle())
		expect(controller.snapshot.overlays).toHaveLength(1)
		act(() => controller.go(-1))
		await act(() => browser.settle())
		expect(close).toHaveBeenCalledExactlyOnceWith(false, undefined)
		expect(controller.snapshot.overlays).toHaveLength(0)
		expect(browser.index).toBe(1)
		controller.dispose()
	})

	it("registers a menu's nested submenu as its own back layer", async () => {
		const browser = createBackHistory()
		const controller = createMobileBackController({ driver: browser.driver, schedule: browser.schedule, enabled: true })
		const parentClose = vi.fn()
		const childClose = vi.fn()
		render(<MobileBackProvider registry={controller}>
			<DropdownMenu defaultOpen onOpenChange={parentClose}>
				<DropdownMenuSub defaultOpen onOpenChange={childClose} />
			</DropdownMenu>
		</MobileBackProvider>)
		await act(() => browser.settle())
		expect(controller.snapshot.overlays).toHaveLength(2)
		act(() => controller.go(-1))
		await act(() => browser.settle())
		expect(childClose).toHaveBeenCalledExactlyOnceWith(false, undefined)
		expect(parentClose).not.toHaveBeenCalled()
		expect(controller.snapshot.overlays).toHaveLength(1)
		controller.dispose()
	})
})
