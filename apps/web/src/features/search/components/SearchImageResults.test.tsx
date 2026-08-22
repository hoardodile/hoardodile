import { screen } from "@testing-library/react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import { searchKeys } from "@/features/search/api"
import { renderRouter } from "@/test/render-router"
import { stubResCard } from "@/test/stubs/cards"

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

describe("SearchImageResults", () => {
	it("shows the best-match similarity on each result card", async () => {
		const { queryClient } = renderRouter({
			initialEntries: ["/search?imageSearch=session-1"],
		})
		queryClient.setQueryData(searchKeys.imageSearch("session-1"), {
			results: [
				{
					resource: stubResCard("res-2", "Two"),
					// (64 - 5) / 64 → 92%
					files: [{ scope: "1.jpg", bits: 64, distance: 5 }],
				},
				{
					resource: stubResCard("res-3", "Three"),
					files: [{ scope: "2.jpg", bits: 64, distance: 0 }],
				},
			],
		})

		const lines = await screen.findAllByTestId("image-search-similarity")
		expect(lines).toHaveLength(2)
		expect(lines[0]?.textContent).toBe("92% similar")
		expect(lines[1]?.textContent).toBe("100% similar")
	})
})
