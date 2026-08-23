import type { Comment } from "@hoardodile/schemas"
import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import { render, screen, waitFor } from "@testing-library/react"
import type { ComponentProps } from "react"
import { beforeAll, describe, expect, it, vi } from "vitest"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { CommentList } from "./CommentList"

function stubComment(id: string, body: string, floor?: number): Comment {
	return {
		id,
		body,
		createdAt: 1_700_000_000_000,
		charIds: [],
		resIds: [],
		likeCount: 0,
		dislikeCount: 0,
		replyCount: 0,
		...(floor !== undefined ? { floor } : {}),
	}
}

type CommentListQueryResult = {
	readonly rows: readonly Comment[]
	readonly total: number
	readonly totalAll: number
	readonly page: number
	readonly size: number
}

function createMockTrpcClient(
	handlers: Record<
		string,
		(input: unknown) => CommentListQueryResult | Promise<CommentListQueryResult>
	>,
): TRPCClient {
	return new Proxy(
		{},
		{
			get(_, namespace: string) {
				return new Proxy(
					{},
					{
						get(_, procedure: string) {
							return {
								query: async (input: unknown) => {
									const key = `${namespace}.${procedure}`
									const handler = handlers[key]
									if (handler) return handler(input)
									return undefined
								},
							}
						},
					},
				)
			},
		},
	) as unknown as TRPCClient
}

const listHandler = vi.fn(
	(
		input: unknown,
	): CommentListQueryResult | Promise<CommentListQueryResult> => {
		const { page = 1, size = 20 } = input as { page?: number; size?: number }
		const total = 45
		const totalAll = 128
		const rows =
			page === 1
				? [
						stubComment("c-1", "First comment", 1),
						stubComment("c-2", "Second", 2),
					]
				: [stubComment("c-3", "Third", 3)]
		return { rows, total, totalAll, page, size }
	},
)

beforeAll(() => {
	setTrpcClient(
		createMockTrpcClient({
			"comment.list": listHandler,
		}),
	)
})

function renderList(props: Partial<ComponentProps<typeof CommentList>> = {}) {
	const queryClient = new QueryClient({
		defaultOptions: { queries: { retry: false } },
	})
	return render(
		<QueryClientProvider client={queryClient}>
			<CommentList input={{ page: 1, size: 20 }} {...props} />
		</QueryClientProvider>,
	)
}

describe("CommentList", () => {
	it("shows loading skeletons before data arrives", () => {
		listHandler.mockImplementationOnce(
			() => new Promise<CommentListQueryResult>(() => undefined),
		)
		renderList()
		expect(screen.getByTestId("comment-list-loading")).toBeInTheDocument()
	})

	it("shows empty state when there are no rows", async () => {
		listHandler.mockImplementationOnce(() => ({
			rows: [],
			total: 0,
			totalAll: 0,
			page: 1,
			size: 20,
		}))
		renderList()
		await waitFor(() => {
			expect(screen.getByTestId("comment-list-empty")).toBeInTheDocument()
		})
		expect(screen.getByText("No messages yet.")).toBeInTheDocument()
	})

	it("renders comment cards when rows are returned", async () => {
		renderList()
		await waitFor(() => {
			expect(screen.getByTestId("comment-c-1")).toBeInTheDocument()
		})
		expect(screen.getByText("First comment")).toBeInTheDocument()
	})

	it("shows pagination when enabled and total exceeds page size", async () => {
		const onPageChange = vi.fn()
		renderList({
			showPagination: true,
			onPageChange,
			input: { page: 1, size: 20 },
		})
		await waitFor(() => {
			expect(screen.getAllByTestId("pagination-current")).toHaveLength(2)
		})
		expect(screen.getAllByTestId("pagination-current")[0]).toHaveTextContent(
			"1",
		)
	})
})
