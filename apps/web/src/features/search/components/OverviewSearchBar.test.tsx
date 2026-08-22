import { screen, waitFor, within } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
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
	vi.stubGlobal(
		"fetch",
		vi.fn(() => mockFetchResponse({ authenticated: true, configured: true })),
	)
})

describe("OverviewSearchBar", () => {
	it("navigates to /search with query on submit", async () => {
		const user = userEvent.setup()
		const { router } = renderRouter({ initialEntries: ["/"] })

		const hero = await screen.findByTestId("overview-search-bar")
		const input = within(hero).getByRole("textbox")
		await user.type(input, "test query")
		await user.keyboard("{Enter}")

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/search")
		})
		expect(router.state.location.search.query).toBe("test query")
	})
})
