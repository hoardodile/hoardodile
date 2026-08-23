import { QueryClient, QueryClientProvider } from "@tanstack/react-query"
import {
	createMemoryHistory,
	createRootRouteWithContext,
	createRoute,
	createRouter,
	Outlet,
	RouterProvider,
} from "@tanstack/react-router"
import { act, render, screen, waitFor } from "@testing-library/react"
import userEvent from "@testing-library/user-event"
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest"
import type { RouterContext } from "@/routes/__root"
import type { TRPCClient } from "@/trpc/client"
import { setTrpcClient } from "@/trpc/client"
import { UsageHistoryPage } from "./UsageHistoryPage"

function createMockTrpcClient(
	handlers: Record<string, (input: unknown) => unknown>,
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
								mutate: async () => undefined,
							}
						},
					},
				)
			},
		},
	) as unknown as TRPCClient
}

function stubUsageTotal(
	entityType: "resource" | "character" | "document",
	entityId: string,
	lastViewedAt: number,
) {
	return {
		id: `${entityType}:${entityId}`,
		entityType,
		entityId,
		granularity: "all",
		period: null,
		totalMs: 1000,
		viewCount: 1,
		lastViewedAt,
		updatedAt: lastViewedAt,
	}
}

const MOCK_NOW = new Date("2026-06-14T12:00:00Z").getTime()

/** Deep per-type windows for the merged All tab. */
const defaultListTotals = vi.fn((input: unknown) => {
	const { entityType } = input as { entityType: string }
	if (entityType === "resource") {
		return [
			stubUsageTotal("resource", "res-1", MOCK_NOW - 60_000),
			stubUsageTotal("resource", "res-2", MOCK_NOW - 3_600_000),
		]
	}
	if (entityType === "character") {
		return [stubUsageTotal("character", "char-1", MOCK_NOW - 120_000)]
	}
	return [stubUsageTotal("document", "doc-1", MOCK_NOW - 240_000)]
})

/** Server-paged rows for the per-type tabs. */
const defaultTotalsPage = vi.fn((input: unknown) => {
	const { entityType, page } = input as {
		entityType: string
		page: number
	}
	if (entityType === "resource") {
		return {
			rows: [
				stubUsageTotal("resource", "res-1", MOCK_NOW - 60_000),
				stubUsageTotal("resource", "res-2", MOCK_NOW - 3_600_000),
			],
			total: 25,
			page,
			size: 20,
		}
	}
	return { rows: [], total: 0, page, size: 20 }
})

const defaultHandlers: Record<string, (input: unknown) => unknown> = {
	"usage.listTotals": defaultListTotals,
	"usage.totalsPage": defaultTotalsPage,
	"resource.detailCard": (input: unknown) => {
		const { id } = input as { id: string }
		return { id, name: `Resource ${id.replace("res-", "")}` }
	},
	"character.detailCard": () => ({ id: "char-1", name: "Character One" }),
	"document.nodeView": () => ({
		node: { id: "doc-1", title: "Document One" },
	}),
}

let originalClient: TRPCClient

beforeAll(() => {
	originalClient = createMockTrpcClient(defaultHandlers)
	setTrpcClient(originalClient)
})

beforeEach(() => {
	setTrpcClient(originalClient)
	defaultListTotals.mockClear()
	defaultTotalsPage.mockClear()
})

function createRouterWith(element: React.ReactElement) {
	const queryClient = new QueryClient({
		defaultOptions: {
			queries: { retry: false },
			mutations: { retry: false },
		},
	})

	const testContext: RouterContext = {
		queryClient,
		trpc: {} as RouterContext["trpc"],
	}

	const rootRoute = createRootRouteWithContext<RouterContext>()({
		component: () => <Outlet />,
	})

	const indexRoute = createRoute({
		getParentRoute: () => rootRoute,
		path: "/",
		component: () => element,
	})

	const router = createRouter({
		routeTree: rootRoute.addChildren([indexRoute]),
		context: testContext,
		history: createMemoryHistory({ initialEntries: ["/"] }),
		defaultPendingMs: 0,
	})

	return { router, queryClient }
}

async function renderPage(platform: string = "all") {
	const { router, queryClient } = createRouterWith(
		<UsageHistoryPage platform={platform as "all" | "web-mobile" | "web-pc"} />,
	)

	await act(async () => {
		await router.load()
	})

	let utils!: ReturnType<typeof render>
	await act(async () => {
		utils = render(
			<QueryClientProvider client={queryClient}>
				<RouterProvider router={router} />
			</QueryClientProvider>,
		)
	})
	return utils
}

describe("UsageHistoryPage", () => {
	it("renders the All tab by default, merging every entity type by recency", async () => {
		await renderPage()

		await waitFor(() => {
			expect(screen.getByTestId("usage-history-rows")).toBeInTheDocument()
		})

		expect(screen.getByRole("tab", { name: "All" })).toBeInTheDocument()
		expect(screen.getByRole("tab", { name: "Resources" })).toBeInTheDocument()
		expect(screen.getByRole("tab", { name: "Characters" })).toBeInTheDocument()
		expect(screen.getByRole("tab", { name: "Documents" })).toBeInTheDocument()

		// Merged order: res-1 (1m), char-1 (2m), doc-1 (4m), res-2 (1h).
		const first = screen.getByTestId("usage-history-resource-res-1")
		expect(first).toHaveTextContent("Resource 1")
		expect(first).toHaveAttribute("href", "/resources/res-1")
		expect(
			screen.getByTestId("usage-history-character-char-1"),
		).toBeInTheDocument()
		expect(
			screen.getByTestId("usage-history-document-doc-1"),
		).toBeInTheDocument()
		expect(
			screen.getByTestId("usage-history-resource-res-2"),
		).toBeInTheDocument()

		// One deep window per type feeds the merged list.
		expect(defaultListTotals).toHaveBeenCalledWith(
			expect.objectContaining({ entityType: "resource", limit: 100 }),
		)
		expect(defaultListTotals).toHaveBeenCalledWith(
			expect.objectContaining({ entityType: "character", limit: 100 }),
		)
		expect(defaultListTotals).toHaveBeenCalledWith(
			expect.objectContaining({ entityType: "document", limit: 100 }),
		)
	})

	it("paginates the All tab client-side with consistent page sizes", async () => {
		const user = userEvent.setup()
		defaultListTotals.mockImplementation((input: unknown) => {
			const { entityType } = input as { entityType: string }
			if (entityType === "resource") {
				return Array.from({ length: 25 }, (_, i) =>
					stubUsageTotal(
						"resource",
						`res-${i + 1}`,
						MOCK_NOW - (i + 1) * 60_000,
					),
				)
			}
			return []
		})
		await renderPage()

		await waitFor(() => {
			expect(screen.getByTestId("usage-history-rows")).toBeInTheDocument()
		})
		expect(
			screen.getByTestId("usage-history-resource-res-1"),
		).toBeInTheDocument()
		expect(
			screen.queryByTestId("usage-history-resource-res-21"),
		).not.toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "2" }))

		await waitFor(() => {
			expect(
				screen.getByTestId("usage-history-resource-res-21"),
			).toBeInTheDocument()
		})
		// Page 2 carries the remainder: 5 resources past the 20-item page.
		expect(
			screen.getAllByTestId(/^usage-history-(resource|character|document)-/),
		).toHaveLength(5)
		// Client-side pagination — no additional server round-trips.
		expect(defaultListTotals).toHaveBeenCalledTimes(3)
	})

	it("switches to the selected tab's server-paginated rows", async () => {
		const user = userEvent.setup()
		await renderPage()

		await waitFor(() => {
			expect(screen.getByTestId("usage-history-rows")).toBeInTheDocument()
		})

		await user.click(screen.getByRole("tab", { name: "Documents" }))

		await waitFor(() => {
			expect(defaultTotalsPage).toHaveBeenCalledWith(
				expect.objectContaining({ entityType: "document", page: 1 }),
			)
		})
		await waitFor(() => {
			expect(screen.getByText("No usage records yet.")).toBeInTheDocument()
		})
	})

	it("shows the empty state for a tab without history", async () => {
		const user = userEvent.setup()
		setTrpcClient(
			createMockTrpcClient({
				...defaultHandlers,
				"usage.totalsPage": () => ({
					rows: [],
					total: 0,
					page: 1,
					size: 20,
				}),
				"usage.listTotals": () => [],
			}),
		)
		await renderPage()

		await waitFor(() => {
			expect(screen.getByText("No usage records yet.")).toBeInTheDocument()
		})
		await user.click(screen.getByRole("tab", { name: "Characters" }))

		await waitFor(() => {
			expect(screen.getByText("No usage records yet.")).toBeInTheDocument()
		})
	})

	it("passes the header platform filter into the queries", async () => {
		await renderPage("web-pc")

		await waitFor(() => {
			expect(screen.getByTestId("usage-history-rows")).toBeInTheDocument()
		})

		expect(defaultListTotals).toHaveBeenCalledWith(
			expect.objectContaining({ entityType: "resource", platform: "web-pc" }),
		)
	})

	it("fetches the next page of an entity tab when clicking the pagination bar", async () => {
		const user = userEvent.setup()
		defaultTotalsPage.mockImplementation((input: unknown) => {
			const { entityType, page } = input as {
				entityType: string
				page: number
			}
			if (entityType === "resource") {
				return {
					rows: [
						stubUsageTotal(
							"resource",
							page === 1 ? "res-1" : "res-21",
							page === 1 ? MOCK_NOW - 60_000 : MOCK_NOW - 86_400_000,
						),
					],
					total: 25,
					page,
					size: 20,
				}
			}
			return { rows: [], total: 0, page, size: 20 }
		})
		await renderPage()

		await user.click(screen.getByRole("tab", { name: "Resources" }))

		await waitFor(() => {
			expect(screen.getByTestId("usage-history-rows")).toBeInTheDocument()
		})
		expect(
			screen.getByTestId("usage-history-resource-res-1"),
		).toBeInTheDocument()

		await user.click(screen.getByRole("button", { name: "2" }))

		await waitFor(() => {
			expect(
				screen.getByTestId("usage-history-resource-res-21"),
			).toBeInTheDocument()
		})
		expect(defaultTotalsPage).toHaveBeenCalledWith(
			expect.objectContaining({ entityType: "resource", page: 2 }),
		)
	})
})
