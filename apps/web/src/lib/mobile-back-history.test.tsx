import {
	Dialog,
	DialogContent,
	DialogTitle,
} from "@hoardodile/ui/components/dialog"
import { MobileBackProvider } from "@hoardodile/ui/hooks/useMobileBackToClose"
import { createMobileBackController } from "@hoardodile/ui/lib/mobile-back-controller"
import {
	createRootRoute,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router"
import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react"
import { useState } from "react"
import { afterEach, describe, expect, it, vi } from "vitest"
import { useDocLeaveGuard } from "@/features/doc/hooks/useDocLeaveGuard"
import { createBackHistory } from "../../../../packages/ui/src/test/back-history"
import { createMobileBackHistory } from "./mobile-back-history"

afterEach(() => {
	cleanup()
	vi.restoreAllMocks()
})

async function setup() {
	const browser = createBackHistory([
		{ href: "/documents/one?mode=read#heading", state: null },
	])
	const controller = createMobileBackController({
		driver: browser.driver,
		schedule: browser.schedule,
		enabled: true,
	})
	const history = createMobileBackHistory(controller)
	await browser.settle()
	const loader = vi.fn()
	function Page() {
		const [open, setOpen] = useState(false)
		useDocLeaveGuard({ dirty: true, message: "Leave document?" })
		return (
			<>
				<button type="button" onClick={() => setOpen(true)}>
					Open
				</button>
				<output data-testid="open">{String(open)}</output>
				<Dialog open={open} onOpenChange={setOpen}>
					<DialogContent>
						<DialogTitle>Editor dialog</DialogTitle>
					</DialogContent>
				</Dialog>
			</>
		)
	}
	const root = createRootRoute({ component: Outlet })
	const doc = createRoute({
		getParentRoute: () => root,
		path: "/documents/$id",
		loader,
		component: Page,
	})
	const router = createRouter({
		routeTree: root.addChildren([doc]),
		history,
		defaultPendingMs: 0,
	})
	render(
		<MobileBackProvider registry={controller}>
			<RouterProvider router={router} />
		</MobileBackProvider>,
	)
	await act(async () => {
		await router.load()
	})
	await screen.findByText("Open")
	const settle = async () => {
		await act(async () => {
			await browser.settle()
		})
		await waitFor(async () => {
			await act(async () => {
				await browser.settle()
			})
			expect(controller.snapshot.pending).toBe(false)
		})
	}
	return { browser, controller, history, router, loader, settle }
}

describe("mobile overlays with a real TanStack Router", () => {
	it("honors explicit ignoreBlocker without leaking it from an out-of-range traversal", async () => {
		const { controller, history, router, settle } = await setup()
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
		act(() => history.push("/documents/two"))
		await settle()
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/documents/two"),
		)
		confirm.mockReturnValue(false)
		confirm.mockClear()
		act(() => history.go(100, { ignoreBlocker: true }))
		await settle()
		act(() => history.back())
		await settle()
		expect(confirm).toHaveBeenCalledTimes(1)
		expect(router.state.location.pathname).toBe("/documents/two")
		act(() => history.back({ ignoreBlocker: true }))
		await settle()
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/documents/one"),
		)
		expect(confirm).toHaveBeenCalledTimes(1)
		history.destroy()
		controller.dispose()
	})
	it("does not load routes, change route state or confirm dirty documents on overlay back", async () => {
		const { browser, controller, history, router, loader, settle } =
			await setup()
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
		const original = router.state.location
		const loads = loader.mock.calls.length
		fireEvent.click(screen.getByText("Open"))
		await settle()
		act(() => history.back())
		await settle()
		expect(screen.getByTestId("open")).toHaveTextContent("false")
		expect(confirm).not.toHaveBeenCalled()
		expect(loader).toHaveBeenCalledTimes(loads)
		expect(router.state.location).toEqual(original)
		expect(browser.driver.read().href).toBe("/documents/one?mode=read#heading")
		history.destroy()
		controller.dispose()
	})

	it("keeps page and overlay when a real route push/replace is blocked, then navigates after approval", async () => {
		const { browser, controller, history, router, settle } = await setup()
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(false)
		fireEvent.click(screen.getByText("Open"))
		await settle()
		for (const kind of ["push", "replace"] as const) {
			act(() => history[kind]("/documents/two"))
			await settle()
			expect(router.state.location.pathname).toBe("/documents/one")
			expect(screen.getByTestId("open")).toHaveTextContent("true")
		}
		expect(confirm).toHaveBeenCalledTimes(2)
		confirm.mockReturnValue(true)
		act(() => history.push("/documents/two"))
		await settle()
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/documents/two"),
		)
		expect(browser.driver.read().href).toBe("/documents/two")
		expect(screen.getByTestId("open")).toHaveTextContent("false")
		act(() => history.back())
		await settle()
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/documents/one"),
		)
		expect(browser.driver.read().href).toBe("/documents/one?mode=read#heading")
		history.destroy()
		controller.dispose()
	})

	it("rolls a refused multi-step route traversal back to the precise origin", async () => {
		const { browser, controller, history, router, settle } = await setup()
		const confirm = vi.spyOn(window, "confirm").mockReturnValue(true)
		act(() => history.push("/documents/two"))
		await settle()
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/documents/two"),
		)
		act(() => history.push("/documents/three"))
		await settle()
		await waitFor(() =>
			expect(router.state.location.pathname).toBe("/documents/three"),
		)
		confirm.mockReturnValue(false)
		act(() => history.go(-2))
		await settle()
		expect(router.state.location.pathname).toBe("/documents/three")
		expect(browser.driver.read().href).toBe("/documents/three")
		expect(controller.snapshot.pending).toBe(false)
		history.destroy()
		controller.dispose()
	})
})
