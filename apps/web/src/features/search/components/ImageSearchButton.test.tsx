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
		vi.fn((input: RequestInfo | URL) => {
			const url = String(input)
			if (url.endsWith("/api/image-search")) {
				return mockFetchResponse({ sessionId: "session-1" })
			}
			return mockFetchResponse({ authenticated: true, configured: true })
		}),
	)
})

describe("ImageSearchButton", () => {
	it("uploads the picked image and navigates to /search with the session id", async () => {
		const user = userEvent.setup()
		const { router } = renderRouter({ initialEntries: ["/"] })

		// Both the sidebar field and the hero field render the button on
		// the overview; scope to the hero like OverviewSearchBar does.
		const hero = await screen.findByTestId("overview-search-bar")
		const button = within(hero).getByTestId("image-search-button")
		const input = within(hero).getByTestId("image-search-input")
		const file = new File(["query"], "query.png", { type: "image/png" })

		await user.click(button)
		await user.upload(input, file)

		await waitFor(() => {
			expect(router.state.location.pathname).toBe("/search")
		})
		expect(router.state.location.search.imageSearch).toBe("session-1")
	})
})
