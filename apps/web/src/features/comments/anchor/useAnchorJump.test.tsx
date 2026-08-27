import {
	createMemoryHistory,
	createRootRoute,
	createRoute,
	createRouter,
	RouterProvider,
} from "@tanstack/react-router"
import { render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { expect, it, vi } from "vitest"
import { z } from "zod"
import {
	type AnchorJumpHandler,
	AnchorJumpProvider,
	useAnchorJump,
} from "./useAnchorJump"

const resDetailSearchSchema = z
	.object({ pluginState: z.unknown().optional() })
	.loose()

function Probe() {
	const jump = useAnchorJump()
	return (
		<button
			type="button"
			onClick={() => jump({ resId: "res-1", data: { pageIndex: 2 } })}
		>
			jump
		</button>
	)
}

function renderWith(jump?: AnchorJumpHandler) {
	const rootRoute = createRootRoute({
		component: () =>
			jump === undefined ? (
				<Probe />
			) : (
				<AnchorJumpProvider handler={jump}>
					<Probe />
				</AnchorJumpProvider>
			),
	})
	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => null,
	})
	const resDetailRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/resources/$id",
		validateSearch: resDetailSearchSchema,
		component: () => null,
	})
	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute, resDetailRoute]),
		history: createMemoryHistory({ initialEntries: ["/"] }),
	})
	render(<RouterProvider router={router} />)
	return router
}

describe("useAnchorJump", () => {
	it("navigates in-app to the resource detail page with the payload untouched", async () => {
		const router = renderWith()
		await userEvent.click(await screen.findByRole("button", { name: "jump" }))
		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/resources/res-1")
		})
		// The payload is arbitrary JSON: the router JSON-serialises and
		// re-parses it, and the host never interprets or re-encodes it.
		expect(router.state.location.search.pluginState).toEqual({
			pageIndex: 2,
		})
	})

	it("prefers the provider handler over the default jump", async () => {
		const handler = vi.fn()
		const router = renderWith(handler)
		await userEvent.click(await screen.findByRole("button", { name: "jump" }))
		expect(handler).toHaveBeenCalledWith({
			resId: "res-1",
			data: { pageIndex: 2 },
		})
		// The provider handler won: no navigation happened.
		expect(router.state.location.pathname).toBe("/")
	})
})
