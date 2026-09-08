import {
	act,
	cleanup,
	fireEvent,
	render,
	screen,
	waitFor,
} from "@testing-library/react"
import { type ReactNode, useState } from "react"
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest"
import { Dialog, DialogContent, DialogTitle } from "../components/dialog"
import { getMobileBackController } from "../lib/mobile-back-browser"
import type { MobileBackController } from "../lib/mobile-back-controller"

let controller: MobileBackController

async function settle() {
	await act(async () => controller.flush())
	await waitFor(() => expect(controller.snapshot.pending).toBe(false))
}

function Nested({ name, children }: { name: string; children?: ReactNode }) {
	const [open, setOpen] = useState(true)
	return (
		<Dialog open={open} onOpenChange={setOpen}>
			<output data-testid={name}>{open ? "open" : "closed"}</output>
			<DialogContent>
				<DialogTitle>{name}</DialogTitle>
				{children}
			</DialogContent>
		</Dialog>
	)
}

function Single() {
	const [open, setOpen] = useState(false)
	return (
		<>
			<button type="button" onClick={() => setOpen(true)}>
				Open
			</button>
			<button type="button" onClick={() => setOpen(false)}>
				Close
			</button>
			<Dialog open={open} onOpenChange={setOpen}>
				<output data-testid="single">{open ? "open" : "closed"}</output>
			</Dialog>
		</>
	)
}

async function traverse(delta: number) {
	await settle()
	const before = JSON.stringify(window.history.state)
	act(() => controller.go(delta))
	await waitFor(() =>
		expect(JSON.stringify(window.history.state)).not.toBe(before),
	)
	await settle()
}

describe("mobile back: browser history regressions", () => {
	beforeEach(() => {
		vi.stubGlobal("matchMedia", () => ({
			matches: true,
			addEventListener() {},
			removeEventListener() {},
		}))
		window.history.pushState({ page: "previous" }, "", "/previous")
		window.history.pushState(
			{ page: "current" },
			"",
			"/current?filter=x#anchor",
		)
		controller = getMobileBackController()
	})
	afterEach(async () => {
		cleanup()
		await settle()
		controller.dispose()
		vi.unstubAllGlobals()
	})

	it("closes the child first when actual parent and child mount open together", async () => {
		render(
			<Nested name="parent">
				<Nested name="child" />
			</Nested>,
		)
		await traverse(-1)
		expect(screen.getByTestId("child")).toHaveTextContent("closed")
		expect(screen.getByTestId("parent")).toHaveTextContent("open")
		expect(window.location.pathname).toBe("/current")
	})

	it("does not let closing a nested child make the next back skip its parent", async () => {
		function Example() {
			const [child, setChild] = useState(false)
			return (
				<Nested name="parent">
					<button type="button" onClick={() => setChild(true)}>
						Child
					</button>
					<button type="button" onClick={() => setChild(false)}>
						Close child
					</button>
					<Dialog open={child} onOpenChange={setChild} />
				</Nested>
			)
		}
		render(<Example />)
		await settle()
		const parentState = window.history.state
		fireEvent.click(screen.getByText("Child"))
		await settle()
		fireEvent.click(screen.getByText("Close child"))
		await settle()
		await waitFor(() => expect(window.history.state).toEqual(parentState))
		await traverse(-1)
		expect(screen.getByTestId("parent")).toHaveTextContent("closed")
		expect(window.location.pathname).toBe("/current")
	})

	it("closes overlays on route replacement and does not resurrect the replaced route", async () => {
		render(<Single />)
		fireEvent.click(screen.getByText("Open"))
		await settle()
		act(() =>
			controller.navigate(
				{ href: "/replacement", state: { page: "replacement" } },
				true,
			),
		)
		await settle()
		expect(screen.getByTestId("single")).toHaveTextContent("closed")
		await traverse(-1)
		await waitFor(() => expect(window.location.pathname).toBe("/previous"))
	})

	it("can open again after each browser-back close", async () => {
		render(<Single />)
		for (let i = 0; i < 4; i++) {
			fireEvent.click(screen.getByText("Open"))
			expect(screen.getByTestId("single")).toHaveTextContent("open")
			await traverse(-1)
			expect(screen.getByTestId("single")).toHaveTextContent("closed")
			expect(window.location.href).toContain("/current?filter=x#anchor")
		}
		await traverse(-1)
		expect(window.location.pathname).toBe("/previous")
	})
})
