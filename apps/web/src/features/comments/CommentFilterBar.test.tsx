import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen } from "@testing-library/react"
import type { ComponentProps } from "react"
import { beforeEach, describe, expect, it, vi } from "vitest"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { CommentFilterBar } from "./CommentFilterBar"
import { COMMENT_SEARCH_DEFAULTS } from "./searchState"

const emptyClient = new Proxy(
	{},
	{
		get() {
			return new Proxy(
				{},
				{
					get() {
						return { query: vi.fn() }
					},
				},
			)
		},
	},
) as unknown as TRPCClient

beforeEach(() => {
	setTrpcClient(emptyClient)
})

function renderFilterBar(
	props: Partial<ComponentProps<typeof CommentFilterBar>> = {},
) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return render(
		<QueryClientProvider client={queryClient}>
			<CommentFilterBar
				state={COMMENT_SEARCH_DEFAULTS}
				patch={vi.fn()}
				{...props}
			/>
		</QueryClientProvider>,
	)
}

describe("CommentFilterBar", () => {
	it("renders the thread/reply count right-aligned in the chips row", () => {
		renderFilterBar({ count: { floors: 2, replies: 1 } })
		expect(screen.getByTestId("comments-count")).toHaveTextContent(
			"2 threads · 1 reply",
		)
	})

	it("omits the count while totals are still loading", () => {
		renderFilterBar()
		expect(screen.queryByTestId("comments-count")).not.toBeInTheDocument()
	})

	it("omits the count for an empty library", () => {
		renderFilterBar({ count: { floors: 0, replies: 0 } })
		expect(screen.queryByTestId("comments-count")).not.toBeInTheDocument()
	})
})
