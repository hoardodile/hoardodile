import { screen, waitFor } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"

import { renderRouter } from "@/test/render-router"

function mockFetchResponse(body: unknown, status = 200) {
	return Promise.resolve(
		new Response(JSON.stringify(body), {
			status,
			headers: { "content-type": "application/json" },
		}),
	)
}

beforeEach(() => {
	vi.restoreAllMocks()
})

describe("route guard", () => {
	it("redirects to /login when auth status returns 401", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				Promise.resolve(
					new Response(JSON.stringify({ error: "unauthorized" }), {
						status: 401,
						headers: { "content-type": "application/json" },
					}),
				),
			),
		)
		const { router } = renderRouter({ initialEntries: ["/"] })

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/login")
		})

		await screen.findByRole("heading", { name: /sign in/i })
	})

	it("redirects to /login when auth status reports authenticated=false", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() =>
				mockFetchResponse({ authenticated: false, configured: true }),
			),
		)
		const { router } = renderRouter({ initialEntries: ["/"] })

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/login")
		})
	})

	it("stays on / when the user is authenticated", async () => {
		vi.stubGlobal(
			"fetch",
			vi.fn(() => mockFetchResponse({ authenticated: true, configured: true })),
		)
		const { router } = renderRouter({ initialEntries: ["/"] })

		await screen.findByTestId("overview-search-bar", undefined, {
			timeout: 5000,
		})
		expect(router.state.location.pathname).toBe("/")
	})
})
